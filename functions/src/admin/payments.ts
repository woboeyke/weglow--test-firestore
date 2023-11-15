
import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { Payment, PaymentInfo } from "../models/Payment";
import { Candle } from "../models/Candle";
import { checkIfCorrectCampaign } from "../auth/authChecks";
import { logEvent, logException, logTrace } from "../helpers/errorLogging";
import { getCandlesFromDb, getLatestCandle } from "../candles/candles";

export const getPaymentInfo = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    const campaignId = data.campaignId;
    await checkIfCorrectCampaign(context.auth, campaignId);

    logTrace("Getting payment info for campaign", { campaignId });

    return await getPaymentInfoFromDb(campaignId);
  } catch (error: unknown) {
    logException(error, { project: data }, "Error getting payment info");
  }
});


export const getPaymentInfoFromDb = async (campaignId: string) => {
  const firestore = admin.firestore();

  if (!campaignId) {
    throw new Error("Campaign id not provided");
  }

  const campaignDocRef = firestore.collection("dashboard-campaigns").doc(campaignId);

  try {
    const campaignDoc = await campaignDocRef.get();

    if (!campaignDoc.exists) {
      throw new Error("Campaign not found");
    }

    const paymentInfo = campaignDoc.get("paymentInfo") as PaymentInfo;

    if (!paymentInfo) {
      throw new Error("Payment info not found");
    }

    return paymentInfo;
  } catch (error: unknown) {
    return logException(error, { campaignId: campaignId }, (error as Error)?.message, "not-found");
  }
};

export const addEditPayment = functions.region("europe-west1").https.onCall(async (data, context) => {
  const editedPayment = data.payment as Payment;
  if (editedPayment.date && typeof editedPayment.date === "string") {
    editedPayment.date = admin.firestore.Timestamp.fromDate(new Date(editedPayment.date));
  }

  const firestore = admin.firestore();
  const campaignId = data.campaignId;
  const paymentId = editedPayment.number;

  await checkIfCorrectCampaign(context.auth, campaignId);

  try {
    await firestore.runTransaction(async (transaction) => {
      const collectionRef = admin.firestore().collection("projects").doc(campaignId).collection("candles");
      const documentRefs = await collectionRef.listDocuments();
      for (const docRef of documentRefs) {
        const docSnapshot = await docRef.get();
        const paymentData = docSnapshot.data();

        const docName = docRef.id;
        if (!isNaN(parseInt(docName))) { // Check if the document name is a number
          const payment = paymentData?.candles.find((payment: Payment) => payment.number === paymentId);
          if (payment) {
            payment.name = editedPayment.name;
            payment.description = editedPayment.description;
            payment.email = editedPayment.email;
            payment.lat = editedPayment.lat;
            payment.lng = editedPayment.lng;
            payment.flames = editedPayment.flames;
            payment.date = editedPayment.date;
            payment.orderId = editedPayment.orderId;

            transaction.update(docRef, {
              candles: paymentData?.candles,
            });
          } else {
            editedPayment.number = paymentData?.candles.length + 1;
            addCandleToCampaign(campaignId, editedPayment);
          }
        }
      }

      logTrace("Payment added/edited", { campaignId, paymentId });
    });
  } catch (error: unknown) {
    logException(error, { campaignId: campaignId, payment: editedPayment }, "Error adding/editing payment");
  }
});

export const deletePayment = functions.region("europe-west1").https.onCall(async (data, context) => {
  const campaignId = data.campaignId;
  const paymentId = data.paymentNumber;

  await checkIfCorrectCampaign(context.auth, campaignId);

  const firestore = admin.firestore();

  try {
    await firestore.runTransaction(async (transaction) => {
      const collectionRef = admin.firestore().collection("projects").doc(campaignId).collection("candles");
      const documentRefs = await collectionRef.listDocuments();
      for (const docRef of documentRefs) {
        const docSnapshot = await docRef.get();
        const paymentData = docSnapshot.data();

        const docName = docRef.id;
        if (!isNaN(parseInt(docName))) { // Check if the document name is a number
          const payment = paymentData?.candles.find((payment: Payment) => payment.number === paymentId);
          if (payment) {
            paymentData?.candles.splice(paymentData?.candles.indexOf(payment), 1);
            transaction.update(docRef, {
              candles: paymentData?.candles,
            });
          }
        }
      }
    });

    await recalculateTotalDonations(campaignId);

    logTrace("Payment deleted", { campaignId, paymentId });
  } catch (error: unknown) {
    logException(error, { campaignId, paymentId }, "Error deleting payment");
  }
});

const addCandleToCampaign = async (campaignId: string, candle: Candle) => {
  const firestore = admin.firestore();

  try {
    await firestore.runTransaction(async (transaction) => {
      // get all numeric documents
      const collectionRef = admin.firestore().collection("projects").doc(campaignId).collection("candles");
      const documentRefs = await collectionRef.listDocuments();

      // get the document with the highest number
      let highestNumber = 0;
      for (const docRef of documentRefs) {
        const docName = docRef.id;
        if (!isNaN(parseInt(docName))) {
          const number = parseInt(docName);
          if (number > highestNumber) {
            highestNumber = number;
          }
        }
      }

      // max candles in a document is 1000
      const maxDocData = await collectionRef.doc(`${highestNumber}`).get();
      if (maxDocData.data()?.candles.length >= 1000) {
        highestNumber++;
      }

      const docRef = collectionRef.doc(`${highestNumber}`);
      const docSnapshot = await docRef.get();
      if (docSnapshot.exists) {
        const docData = docSnapshot.data();
        if (docData) {
          docData.candles.push(candle);
          transaction.update(docRef, {
            candles: docData.candles,
          });
        }
      } else {
        transaction.set(docRef, {
          candles: [candle],
        });
      }

      await recalculateTotalDonations(campaignId);

      return highestNumber;
    });
  } catch (error: unknown) {
    logException(error, { campaignId, candle }, "Error adding candle");
  }
};

export const recalculateTotalDonations = async (campaignId: string) => {
  try {
    const candles = await getCandlesFromDb(campaignId, 0, -1);

    const totalDonations = candles.totalCount;
    const totalDonated = candles.data.reduce((a, b) => {
      return a + b.flames;
    }, 0);

    const currentFlame = await getLatestCandle(campaignId);

    const firestore = admin.firestore();
    await firestore.collection("projects").doc(campaignId).set({
      info: {
        __total: totalDonations,
        __totalflame: totalDonated,
        __currentflame: currentFlame,
      },
    }, { merge: true });

    logEvent("TotalDonationsRecalculated", { campaignId, totalDonations, totalDonated });

    return { totalDonations: totalDonations, totalDonated: totalDonated };
  } catch (error: unknown) {
    logException(error, { campaignId: campaignId });
  }
};
