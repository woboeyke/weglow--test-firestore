import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { createNewAnalyticsProperty } from "../analytics/analytics";
import { Content } from "../models/Content/Content";
import { deleteRule, editRule, newRule } from "./FirestoreRules";
import { Payment, PaymentDto, PaymentInfo, defaultPaymentInfo } from "../models/Payment";
import { updateMissingTranslations } from "../translations/translations";
import { createContainer, deleteContainer, renameContainer } from "../blob/blob";
import { validateCampaign } from "./validateCampaign";
import { appInsights } from "../index";
import { deleteAnalyticsProperty } from "../analytics/properties";
import { Candle } from "../models/Candle";
import { supportedLanguages } from "../secrets/deepl";
import { getPaymentInfoFromDb } from "./payments";
import { getUserRolesFromDb } from "../auth/auth";
import { InfoDoc, defaultInfoDoc } from "../models/InfoDoc";
import { checkIfAdmin, checkIfCorrectCampaign, checkIfLoggedIn } from "../auth/authChecks";
import { logException, logTrace } from "../helpers/errorLogging";
import { CampaignListItem, ICampaign } from "../models/Campaign";

export * from "./dashboard/dashboard";
export * from "./dashboard/adminDashboard";
export * from "./payments";

export const getAllCampaignNames = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    await checkIfAdmin(context.auth);
    logTrace("Getting all campaign names");

    const campaigns = await getAllCampaignNamesFromDb();

    logTrace("All campaign names retrieved");

    return campaigns;
  } catch (error: unknown) {
    logException(error);
  }
});

export const getAllCampaignNamesFromDb = async () => {
  try {
    const campaigns = (await admin.firestore().collection("dashboard-campaigns").get()).docs.map((doc) => {
      return { label: doc.data().displayName, id: doc.id, legacy: !doc.data().content } as CampaignListItem;
    });

    return campaigns;
  } catch (error: unknown) {
    logException(error);
  }
};

export const getCampaign = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    logTrace("Getting campaign");

    const campaignId = data.campaignId;
    await checkIfCorrectCampaign(context.auth, campaignId);

    const campaignDoc = await admin.firestore().collection("dashboard-campaigns").doc(campaignId).get();
    if (!campaignDoc.exists) {
      throw new functions.https.HttpsError("not-found", `Campaign ${campaignId} not found`);
    }

    const campaign = {
      id: campaignId,
      displayName: campaignDoc.data()?.displayName,
      analytics: {
        propertyId: campaignDoc.data()?.analytics?.propertyId,
        measurementId: campaignDoc.data()?.analytics?.measurementId,
      },
      endDate: campaignDoc.data()?.endDate.toDate().toISOString(),
      paymentMethod: campaignDoc.data()?.paymentInfo?.paymentMethod,
      content: campaignDoc.data()?.content as Content,
      customURL: campaignDoc.data()?.customURL ?? "",
      updateNumber: campaignDoc.data()?.updateNumber ?? 0,
    } as ICampaign;

    logTrace("Campaign retrieved", { campaignId });

    return campaign;
  } catch (error: unknown) {
    logException(error);
  }
});

export const updatePaymentInfo = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    const project = data.campaignId;
    await checkIfCorrectCampaign(context.auth, project);
    const paymentInfo = data.paymentInfo as PaymentInfo;

    logTrace("Updating payment info for project", { project });

    if (!paymentInfo) {
      throw new functions.https.HttpsError("invalid-argument", "Invalid payment info");
    }

    const firestore = admin.firestore();
    const doc = await firestore.collection("dashboard-campaigns").doc(`${project}`).get();
    if (!doc.exists) {
      throw new functions.https.HttpsError("not-found", "Project does not exist");
    }

    await firestore.collection("dashboard-campaigns").doc(`${project}`).update({
      paymentInfo: paymentInfo,
    });

    return project;
  } catch (error: unknown) {
    logException(error, { data: data });
  }
});

export const getPayments = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    if (!data.campaignId) {
      throw new functions.https.HttpsError("invalid-argument", "Invalid campaign id");
    }

    logTrace("Getting payments for campaign", { campaignId: data.campaignId });

    const from = data.from ?? "";
    const to = data.to ?? "";
    const campaignId = data.campaignId;

    await checkIfCorrectCampaign(context.auth, campaignId);

    const paymentList = [];
    const collectionRef = admin.firestore().collection("projects").doc(campaignId).collection("candles");
    const documentRefs = await collectionRef.listDocuments();
    for (const docRef of documentRefs) {
      const docSnapshot = await docRef.get();
      const paymentData = docSnapshot.data();

      const docName = docRef.id;
      if (!isNaN(parseInt(docName))) { // Check if the document name is a number
        const partialPaymentData = paymentData?.candles.map((payment: Payment) => {
          const paymentDate = payment.date.toDate();
          const fromDate = from ? new Date(from) : new Date();
          fromDate.setHours(0, 0, 0, 0);
          const toDate = to ? new Date(to) : new Date();
          toDate.setHours(23, 59, 59, 999);

          if ((!from && !to) || (paymentDate >= fromDate && paymentDate <= toDate)) {
            return {
              date: paymentDate.toISOString(),
              description: payment.description ?? "",
              flames: payment.flames,
              name: payment.name,
              number: payment.number,
              email: payment.email ?? "",
              lat: payment.lat,
              lng: payment.lng,
              orderId: payment.orderId ?? "",
            } as PaymentDto;
          }

          return null;
        }).filter((payment: PaymentDto | null) => payment !== null);

        paymentList.push(...partialPaymentData);
      }
    }

    if (!paymentList || paymentList.length === 0) {
      return [];
    }

    paymentList.sort((a, b) => b.number - a.number);

    logTrace("Payments retrieved for campaign", { campaignId: data.campaignId, amount: paymentList.length });

    return paymentList;
  } catch (error: unknown) {
    logException(error, { data: data });
  }
});

export const newCampaign = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    await checkIfAdmin(context.auth);

    const firestore = admin.firestore();
    const campaign = data as ICampaign;
    const campaignId = campaign.id;

    logTrace("Creating campaign", { campaignId });

    try { // Validate
      validateCampaign(campaign);
    } catch (error: unknown) {
      throw new functions.https.HttpsError("invalid-argument", (error as Error).message);
    }

    try {
      await updateMissingTranslations(campaign.content, supportedLanguages);
    } catch (error: unknown) {
      throw new functions.https.HttpsError("internal", "An error occurred while translating the campaign. " + (error as Error).message);
    }


    await firestore.runTransaction(async (transaction) => {
      const campaignDoc = await transaction.get(firestore.collection("dashboard-campaigns").doc(campaignId));

      if (campaignDoc.exists) {
        throw new functions.https.HttpsError("already-exists", "Campaign already exists");
      }

      campaign.paymentInfo = defaultPaymentInfo;
      campaign.paymentInfo.paymentMethod = campaign.paymentMethod;

      transaction.set(firestore.collection("dashboard-campaigns").doc(campaignId), {
        displayName: campaign.displayName,
        analytics: {
          propertyId: campaign.analytics.propertyId,
          measurementId: campaign.analytics.measurementId,
        },
        endDate: admin.firestore.Timestamp.fromDate(new Date(campaign.endDate)),
        content: campaign.content,
        paymentInfo: campaign.paymentInfo,
        customURL: campaign.customURL ?? "",
        updateNumber: 0,
      });

      transaction.set(firestore.collection("projects").doc(campaignId).collection("candles").doc("0"), {
        candles: [],
      });

      transaction.set(firestore.collection("projects").doc(campaignId), {
        info: defaultInfoDoc,
      });

      if (!campaign.analytics.propertyId) {
        const { propertyId, measurementId } = await createNewAnalyticsProperty(campaign.displayName, campaign.customURL);
        campaign.analytics.propertyId = propertyId;
        campaign.analytics.measurementId = measurementId;
        transaction.update(firestore.collection("dashboard-campaigns").doc(campaignId), {
          analytics: {
            propertyId: propertyId,
            measurementId: measurementId,
          },
        });
      }
    });

    // Last because this can't be rolled back
    await createContainer(campaignId);
    await newRule(campaignId);

    logTrace("Campaign created", { campaignId });

    return campaignId;
  } catch (error: unknown) {
    logException(error, { data: data });
  }
});

export const deleteCampaign = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    await checkIfAdmin(context.auth);

    const firestore = admin.firestore();
    const campaignId = data;

    if (!campaignId) {
      throw new functions.https.HttpsError("invalid-argument", "Invalid campaign id");
    }

    await firestore.runTransaction(async (transaction) => {
      const campaignDoc = await transaction.get(firestore.collection("dashboard-campaigns").doc(campaignId));
      if (!campaignDoc.exists) {
        throw new functions.https.HttpsError("not-found", "Campaign not found");
      }

      transaction.delete(firestore.collection("dashboard-campaigns").doc(campaignId));

      try {
        if (campaignDoc.data()?.analyticsId) {
          await deleteAnalyticsProperty(campaignDoc.data()?.analyticsId);
        }
      } catch (error: unknown) {
        // Id might not be ours
        appInsights.defaultClient.trackException({ exception: error as Error, properties: { campaignId: campaignId } });
      }

      const collectionRef = admin.firestore().collection("projects").doc(campaignId).collection("candles");
      const documentRefs = await collectionRef.listDocuments();
      for (const docRef of documentRefs) {
        const docName = docRef.id;
        if (!isNaN(parseInt(docName))) { // Check if the document name is a number
          transaction.delete(docRef);
        }
      }
      transaction.delete(firestore.collection("projects").doc(campaignId));
    });

    await deleteContainer(campaignId);

    // Last because this can't be rolled back
    await deleteRule(campaignId);

    logTrace("Campaign deleted", { campaignId });

    return campaignId;
  } catch (error: unknown) {
    logException(error, { data: data }, "An error occurred while deleting the campaign");
  }
});

export const editCampaign = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    const campaign = data.campaign as ICampaign;
    const campaignId = campaign.id;
    const originalId = data.originalId;

    await checkIfCorrectCampaign(context.auth, originalId);
    const firestore = admin.firestore();

    try { // Validate
      validateCampaign(campaign);
    } catch (error: unknown) {
      throw new functions.https.HttpsError("invalid-argument", (error as Error).message);
    }

    await checkIfCampaignWasEdited(originalId, campaign.updateNumber);
    campaign.updateNumber++;

    try {
      await updateMissingTranslations(campaign.content, supportedLanguages);
    } catch (error: unknown) {
      throw new functions.https.HttpsError("internal", "An error occurred while translating the campaign. " + (error as Error).message);
    }

    const candlesList = [] as {
      candles: Candle[];
      id: string;
    }[];
    const info = defaultInfoDoc as InfoDoc;

    if (originalId !== campaignId) {
      // Get original data
      await firestore.runTransaction(async (transaction) => {
        const collectionRef = admin.firestore().collection("projects").doc(originalId).collection("candles");
        const documentRefs = await collectionRef.listDocuments();
        for (const docRef of documentRefs) {
          const docSnapshot = await docRef.get();
          const docData = docSnapshot.data();
          const docName = docRef.id;
          if (!isNaN(parseInt(docName))) { // Check if the document name is a number
            candlesList.push({
              candles: docData?.candles as Candle[],
              id: docName,
            });
          }
        }

        const originalInfo = (await transaction.get(firestore.collection("projects").doc(originalId))).data();
        info.__current = originalInfo?.info?.__current;
        info.__currentflame = originalInfo?.info?.__currentflame;
        info.__total = originalInfo?.info?.__total;
        info.__totalflame = originalInfo?.info?.__totalflame;
      });

      await renameContainer(originalId, campaignId);

      // Last because this can't be rolled back
      await editRule(originalId, campaignId);
    }

    await firestore.runTransaction(async (transaction) => {
      const campaignDoc = await transaction.get(firestore.collection("dashboard-campaigns").doc(originalId));

      if (!campaignDoc.exists) {
        throw new functions.https.HttpsError("not-found", `Campaign ${originalId} not found`);
      }

      if (originalId !== campaignId) {
        transaction.delete(firestore.collection("dashboard-campaigns").doc(originalId));

        campaign.paymentInfo = await getPaymentInfoFromDb(campaignId);
        campaign.paymentInfo.paymentMethod = campaign.paymentMethod;

        transaction.set(firestore.collection("dashboard-campaigns").doc(campaignId), {
          displayName: campaign.displayName,
          analytics: {
            propertyId: campaign.analytics.propertyId,
            measurementId: campaign.analytics.measurementId,
          },
          endDate: admin.firestore.Timestamp.fromDate(new Date(campaign.endDate)),
          content: campaign.content,
          paymentInfo: campaign.paymentInfo,
          customURL: campaign.customURL ?? "",
        });

        for (const candleList of candlesList) {
          transaction.delete(firestore.collection("projects").doc(originalId).collection("candles").doc(candleList.id));
          transaction.set(firestore.collection("projects").doc(campaignId).collection("candles").doc(candleList.id), {
            candles: candleList.candles,
          });
        }

        transaction.update(firestore.collection("projects").doc(originalId), {
          info: admin.firestore.FieldValue.delete(),
        });
        transaction.update(firestore.collection("projects").doc(campaignId), {
          info: info,
        });
      } else {
        campaign.paymentInfo = await getPaymentInfoFromDb(campaignId);
        campaign.paymentInfo.paymentMethod = campaign.paymentMethod;
        transaction.update(firestore.collection("dashboard-campaigns").doc(originalId), {
          displayName: campaign.displayName,
          analytics: {
            propertyId: campaign.analytics.propertyId,
            measurementId: campaign.analytics.measurementId,
          },
          endDate: admin.firestore.Timestamp.fromDate(new Date(campaign.endDate)),
          content: campaign.content,
          paymentInfo: campaign.paymentInfo,
          customURL: campaign.customURL ?? "",
        });
      }

      if (!campaign.analytics.propertyId) {
        const { propertyId, measurementId } = await createNewAnalyticsProperty(campaign.displayName, campaign.customURL);
        campaign.analytics.propertyId = propertyId;
        campaign.analytics.measurementId = measurementId;
        transaction.update(firestore.collection("dashboard-campaigns").doc(campaignId), {
          analytics: {
            propertyId: propertyId,
            measurementId: measurementId,
          },
        });
      }
    });

    logTrace("Campaign edited", { campaignId });

    return campaignId;
  } catch (error: unknown) {
    logException(error, { data: data }, "An error occurred while starting the editCampaign function");
  }
});

const checkIfCampaignWasEdited = async (campaignId: string, updateNumber: number) => {
  const firestore = admin.firestore();
  const campaignDoc = await firestore.collection("dashboard-campaigns").doc(campaignId).get();
  if (!campaignDoc.exists) {
    throw new functions.https.HttpsError("not-found", `Campaign ${campaignId} not found`);
  }

  const campaign = campaignDoc.data() as ICampaign;
  if (campaign.updateNumber !== updateNumber) {
    logTrace("Campaign was edited while editing", { campaignId, originalId: campaign?.updateNumber, receivedId: updateNumber });
    throw new functions.https.HttpsError("failed-precondition", "Campaign was edited while you were editing it. Please refresh the page and try again.");
  }
};

export const getAvailableProjects = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    await checkIfLoggedIn(context.auth);

    const userRoles = await getUserRolesFromDb(context.auth?.uid ?? "");
    const campaigns = (await admin.firestore().collection("dashboard-campaigns").get()).docs.map((doc) => {
      return {
        label: doc.data().displayName,
        id: doc.id,
        legacy: !doc.data().content,
      } as CampaignListItem;
    }).filter((campaign) => userRoles.includes(campaign.id) || userRoles.includes("SuperAdmin"));

    return campaigns;
  } catch (error: unknown) {
    logException(error, { data: data });
  }
});
