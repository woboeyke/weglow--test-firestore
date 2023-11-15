import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as helpers from "../../helpers/helpers";
import Axios from "axios";
import { startSendEmail } from "../candles";
import { appInsights } from "../../index";
import { payconiqTestUrl, payconiqUrl } from "../../secrets/payconiq";
import { logEvent, logException } from "../../helpers/errorLogging";
import { AddCandleDTO } from "../../models/Candle";
import cors = require("cors");

export const addCandleWithPayconiq = async (candle: AddCandleDTO) => {
  try {
    const firestore = admin.firestore();
    const doc = await firestore.collection("dashboard-campaigns").doc(`${candle.project}`).get();
    if (!doc.exists) {
      throw new functions.https.HttpsError("invalid-argument", "Project does not exist");
    }

    const isTest = process.env.PAYCONIQ_TESTMODE;
    let apiKey = doc.data()?.paymentInfo?.payconiqApiKey ?? "";
    if (isTest == "1") {
      apiKey = "52989c01-9fc3-47b0-884e-2356aa203862";
    }

    if (!apiKey) {
      throw new functions.https.HttpsError("invalid-argument", "Payconiq api key not found");
    }

    const uid = "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === "x" ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });

    let returnUrl = `https://${candle.project}.weglow.world/success?orderId=${uid}&paymentMethod=payconiq`;
    const customURL = doc.data()?.customURL?.replace(/\/+$/, "") ?? "";

    if (customURL && customURL.length > 0) {
      returnUrl = `${customURL}/success?orderId=${uid}&paymentMethod=payconiq`;
    } else if (isTest == "1") {
      returnUrl = `http://localhost:9000/success?orderId=${uid}&paymentMethod=payconiq`;
    }

    const payconiqAmount = candle.flames * 100;

    console.log(`Payconiq info:\nkey: ${apiKey}\nuid: ${uid}\nreturnUrl: ${returnUrl}\npayconiqAmount: ${payconiqAmount}\nproject: ${candle.project}`);

    let url = payconiqUrl;
    if (isTest == "1") {
      url = payconiqTestUrl;
    }

    logEvent("PayconiqPaymentCreating", { uid, returnUrl, payconiqAmount, project: candle.project, isTest, payconiqUrl: url, partialApiKey: apiKey?.substring(0, 5) });

    const response = Axios.post(url + "/v3/payments", {
      "amount": `${payconiqAmount}`,
      "currency": "EUR",
      "callbackUrl": "https://europe-west1-we-glow.cloudfunctions.net/PaymentCompleteWithPayconiq",
      "description": `Donatie voor ${candle.project}`,
      "reference": uid,
      "returnUrl": returnUrl,
    }, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
    });
    return response.then((response) => {
      logEvent("PayconiqPaymentCreated", { message: "Payconiq payment created, getting checkout url", uid, paymentId: response?.data?.paymentId, project: candle?.project, paymentMethod: "payconiq" });
      return response.data;
    }).then(async (result) => {
      logEvent("PayconiqPaymentCreatedSuccesfully", { uid, paymentId: result?.paymentId, project: candle?.project, paymentMethod: "payconiq", checkoutUrl: result?._links?.checkout?.href });

      const resultDoc = await firestore.collection("payments/payconiq/cache").doc(`${uid}`).get();
      if (resultDoc.exists) {
        console.log("Error while getting payconiq cache, doc already exists");
        throw new functions.https.HttpsError("invalid-argument", "Id already exists");
      }

      await firestore.collection("payments/payconiq/cache").doc(`${uid}`).set({
        lat: candle.lat,
        lng: candle.lng,
        flames: candle.flames,
        description: candle.description,
        name: candle.name,
        email: candle.email ?? "",
        date: admin.firestore.Timestamp.now(),
        paymentId: result.paymentId,
        project: candle.project,
        orderId: uid,
        ...(candle.anonymous ? { anonymous: true } : {}), // Add 'anonymous' only if it's true
      });

      logEvent("PayconiqPaymentCreatedSuccesfully", { uid, paymentId: result?.paymentId, project: candle?.project, paymentMethod: "payconiq", checkoutUrl: result?._links?.checkout?.href });

      return {
        checkoutUrl: result._links.checkout.href,
      };
    }).catch((error) => {
      logException(error, { error: error.request.data ?? error.request ?? error, candle }, "Error while creating payconiq payment", "invalid-argument");
    });
  } catch (error: unknown) {
    logException(error, { candle });
  }
};

export const PaymentCompleteWithPayconiq = functions.region("europe-west1").https.onRequest(async (req, res) => {
  const corsObj = cors({ origin: "*" });
  corsObj(req, res, () => {
    try {
      const { status, reference } = req.body;
      if (!reference) {
        console.log("Error while getting payconiq payment, reference not found");
        appInsights.defaultClient.trackException({ exception: new Error("Error while getting payconiq payment, reference not found"), properties: { requestBody: req?.body, reference: reference, status: status } });
        return helpers.badRequestResult(req, res);
      }
      if (status != "SUCCEEDED") {
        // Log cancel and return something else than ok
        logEvent("PayconiqPaymentCancelled", { reference, paymentMethod: "payconiq", status });

        return res.status(200).send("OK");
      }

      const firestore = admin.firestore();

      console.log("Getting payconiq cache", reference);
      return firestore.collection("payments/payconiq/cache").doc(`${reference}`).get().then(async (doc) => {
        if (!doc.exists) {
          appInsights.defaultClient.trackException({ exception: new Error("Error while getting payconiq cache, doc not found"), properties: { reference: reference } });
          return helpers.badRequestResult(req, res);
        }
        const data = doc.data() as AddCandleDTO;
        const emailAddr = doc.data()?.email;

        const campaignDoc = await firestore.collection("dashboard-campaigns").doc(`${data.project}`).get();
        if (!campaignDoc.exists) {
          throw new functions.https.HttpsError("invalid-argument", "Project does not exist");
        }
        const apiKey = campaignDoc.data()?.paymentInfo?.payconiqApiKey;

        if (!apiKey) {
          throw new functions.https.HttpsError("invalid-argument", `Payconiq api key not found in project ${data?.project}`);
        }

        logEvent("PayconiqPaymentSucceeded", { reference, paymentId: data?.paymentId, project: data?.project, paymentMethod: "payconiq", partialAPiKey: apiKey?.substring(0, 5) });

        const response = Axios.get(payconiqUrl + `/v3/payments/${data.paymentId}`, {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
          },
        });
        return response.then((payconiqResponse) => {
          if (payconiqResponse.data.status !== "SUCCEEDED") {
            appInsights.defaultClient.trackException({ exception: new Error("Error while getting payconiq payment, status not succeeded"), properties: { reference: reference, payconiqResponse: payconiqResponse.data, status: status, paymentId: data?.paymentId } });
            return res.status(400).send("Bad Request");
          }

          // Move to payed
          const paymentPlatformRef = "payments/payconiq";
          const promise1 = firestore.collection(`${paymentPlatformRef}/payed`).add(data);
          const promise2 = firestore.collection(`${paymentPlatformRef}/cache`).doc(`${reference}`).delete();
          const promise3 = firestore.collection(`${paymentPlatformRef}/payedreference`).doc(`${reference}`).set(req.body);

          // add amount(€) as parameter to startSendEmail
          const promise4 = startSendEmail(emailAddr, data.project ?? "", data.language, reference, data.flames);

          const promises = [promise1, promise2, promise3, promise4];

          return Promise.all(promises).then(() => {
            logEvent("PayconiqPaymentSucceeded", { reference, paymentId: data?.paymentId, project: data?.project, paymentMethod: "payconiq", partialAPiKey: apiKey?.substring(0, 5) });

            return res.status(200).send("OK");
          });
        }).catch((error) => {
          appInsights.defaultClient.trackException({ exception: error, properties: { reference: reference, message: "Error processing successful payconiq payment", requestBody: req?.body } });
          return helpers.badRequestResult(req, res);
        });
      }).catch((error) => {
        appInsights.defaultClient.trackException({ exception: error, properties: { reference: reference, message: "Error while moving from payconiq cache", requestBody: req?.body } });
        return helpers.badRequestResult(req, res);
      });
    } catch (error: unknown) {
      appInsights.defaultClient.trackException({ exception: error as Error, properties: { requestBody: req?.body, message: "Error while processing payconiq payment" } });
      return helpers.badRequestResult(req, res);
    }
  });
});
