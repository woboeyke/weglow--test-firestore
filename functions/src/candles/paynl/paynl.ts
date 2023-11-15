import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as helpers from "../../helpers/helpers";
import * as qs from "qs";
import Axios from "axios";
import { startSendEmail } from "../candles";
import { appInsights } from "../../index";
import { payNLBasic, payNLUrl } from "../../secrets/paynl";
import { logEvent, logException } from "../../helpers/errorLogging";
import { AddCandleDTO } from "../../models/Candle";
import { IPayNLTransactionStatusResponse } from "../../models/PayNL";
import cors = require("cors");

export const addCandleWithPayNL = async (candle: AddCandleDTO, ipAddress: string) => {
  try {
    const payNLAmount = candle.flames * 100;
    console.log("Using language: " + candle.language);

    const testMode = process.env.PAYNL_TESTMODE;

    const callbackUrl = "https://europe-west1-we-glow.cloudfunctions.net/PaymentCompleteWithPayNL";
    const firstName = candle.name.split(" ")[0];
    const lastName = candle.name.indexOf(" ") != -1 ? candle.name.substring(candle.name.indexOf(" ") + 1) : "";

    const firestore = admin.firestore();
    const doc = await firestore.collection("dashboard-campaigns").doc(`${candle.project}`).get();
    if (!doc.exists) {
      throw new functions.https.HttpsError("invalid-argument", "Project does not exist");
    }
    const serviceId = doc.data()?.paymentInfo?.payNLServiceId;

    if (!serviceId) {
      throw new functions.https.HttpsError("invalid-argument", "PayNL serviceId not found");
    }

    let returnUrl = `https://${candle.project}.weglow.world/success`;
    const customURL = doc.data()?.customURL?.replace(/\/+$/, "") ?? "";

    if (customURL && customURL.length > 0) {
      returnUrl = `${customURL}/success`;
    } else if (testMode == "1") {
      returnUrl = "http://localhost:9000/success";
    }

    const paynlData = qs.stringify({
      "serviceId": serviceId,
      "amount": payNLAmount,
      "ipAddress": ipAddress,
      "finishUrl": returnUrl,
      "testmode": testMode,
      "transaction": {
        "currency": "EUR",
        "orderExchangeUrl": callbackUrl,
        "description": "Bougie voor Bart",
      },
      "enduser": {
        "language": candle.language ? candle.language.toUpperCase().split("-")[1] : "NL",
        "emailAddress": candle.email ?? "",
        "initials": firstName,
        "lastName": lastName,
      },
    });

    const config = {
      method: "post",
      maxBodyLength: Infinity,
      url: payNLUrl,
      headers: {
        "authorization": payNLBasic,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: paynlData,
    };

    try {
      const response = await Axios.request(config);
      const result = response.data;
      if (result.request?.result === "0") {
        throw new functions.https.HttpsError("unknown", JSON.stringify({ message: result.request?.errorMessage, code: result.request?.errorId }));
      }

      if (result.enduser?.blacklist === "1") {
        return logException(new Error("Blacklisted by PayNL"), { ipAddress, candle, result }, "Blacklisted by PayNL", "permission-denied");
      }

      const firestore = admin.firestore();

      const resultDoc = await firestore.collection("payments/paynl/cache").doc(`${result.transaction.transactionId}`).get();
      if (resultDoc.exists) {
        throw new functions.https.HttpsError("invalid-argument", "Bad request, Id already exists");
      }
      await firestore.collection("payments/paynl/cache").doc(`${result.transaction.transactionId}`).set({
        lat: candle.lat,
        lng: candle.lng,
        flames: candle.flames,
        description: candle.description ?? "",
        name: candle.name,
        email: candle.email ?? "",
        date: admin.firestore.Timestamp.now(),
        project: candle.project,
        orderId: result.transaction.transactionId,
        ...(candle.anonymous ? { anonymous: true } : {}), // Add 'anonymous' only if it's true
      });
      return { checkoutUrl: result.transaction.paymentURL };
    } catch (error: unknown) {
      logException(error, { candle, ipAddress: ipAddress, error: (error as Error)?.message }, "Error while getting paynl payment", "invalid-argument");
    }
  } catch (error: unknown) {
    logException(error, { candle });
  }
};

export const PaymentCompleteWithPayNL = functions.region("europe-west1").https.onRequest(async (req, res) => {
  const corsObj = cors({ origin: "*" });
  corsObj(req, res, async () => {
    try {
      // Get /?order_id=2116843980X42870&orderStatusId=100&paymentSessionId=2116843980 from req.url (body is empty, so we need to get it from url)
      const url = req.url;

      if (!url || !url.includes("order_id=")) {
        appInsights.defaultClient.trackException({ exception: new Error("Incorrect url"), properties: { url: url } });
        return helpers.badRequestResult(req, res);
      }

      const orderId = url.split("order_id=")[1].split("&")[0];

      if (!orderId) {
        appInsights.defaultClient.trackException({ exception: new Error("Incorrect orderId"), properties: { orderId: orderId } });
        return helpers.badRequestResult(req, res);
      }

      // Move from cache to payedreference
      const firestore = admin.firestore();
      return firestore.collection("payments/paynl/cache").doc(`${orderId}`).get().then((doc) => {
        if (doc.exists) {
          const emailAddr = doc.data()?.email;
          const data = doc.data() as AddCandleDTO;
          data.orderId = orderId;
          const transactionId = doc.id;

          // Check if payment is indeed payed
          const options = {
            method: "POST",
            url: `https://rest-api.pay.nl/v14/Transaction/status/json?transactionId=${transactionId}`,
            headers: {
              accept: "application/json",
              authorization: payNLBasic,
            },
          };

          const response = Axios.request(options);
          return response.then((response) => {
            // console.log("Returing response");
            return response.data as IPayNLTransactionStatusResponse;
          }).then((result: IPayNLTransactionStatusResponse) => {
            console.log("Payment state: " + result.paymentDetails.state);
            if (result.paymentDetails.state === "100") {
              // Move to payed
              const paymentPlatformRef = "payments/paynl";
              const promise1 = firestore.collection(`${paymentPlatformRef}/payed`).add(data ?? {});
              const promise2 = firestore.collection(`${paymentPlatformRef}/cache`).doc(orderId).delete();
              const promise3 = firestore.collection(`${paymentPlatformRef}/payedreference`).add(result ?? {});

              const promise4 = startSendEmail(emailAddr, data.project ?? "", data.language);

              const promises = [promise1, promise2, promise3, promise4];

              return Promise.all(promises).then(() => {
                // All promises done, returning TRUE"
                logEvent("PayNLPaymentCompleted", { orderId, transactionId });

                return res.status(200).send("TRUE"); // Must be TRUE, otherwise pay.nl doesn't know it's ok on our side
              });
            } else if (result.paymentDetails.state === "20" || result.paymentDetails.state === "50" || result.paymentDetails.state === "90") {
              // Payment still pending.. returning TRUE
              logEvent("PayNLPaymentPending", { orderId, transactionId });

              return res.status(200).send("TRUE");
            } else {
              appInsights.defaultClient.trackException({ exception: new Error("Payment not yet completed?"), properties: { orderId: orderId, transactionId: transactionId } });
              return helpers.badRequestResult(req, res);
            }
          }).catch(() => {
            appInsights.defaultClient.trackException({ exception: new Error("Error in response"), properties: { orderId: orderId, transactionId: transactionId } });
            return helpers.badRequestResult(req, res);
          });
        } else {
          // console.log("Doc does not exist, sending bad request");
          // return helpers.badRequestResult(req, res);
          // Doc doesn't exist (yet?), but we still need to return TRUE, otherwise pay.nl doesn't know it's ok on our side
          logEvent("PayNLPaymentPending", { orderId });

          return res.status(200).send("TRUE");
        }
      }).catch(() => {
        appInsights.defaultClient.trackException({ exception: new Error("Error in getting doc"), properties: { orderId: orderId } });
        return helpers.badRequestResult(req, res);
      });
    } catch (error: unknown) {
      appInsights.defaultClient.trackException({ exception: error as Error, properties: { requestBody: req?.body } });
      return helpers.badRequestResult(req, res);
    }
  });
});
