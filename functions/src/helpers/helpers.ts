import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { PaymentMethod } from "../models/Payment";
import { appInsights } from "../index";
import { supportedLanguages } from "../secrets/deepl";
import { CampaignAnalytics } from "../models/Campaign";

const firestore = admin.firestore();

export const projectExists = async (project: string) => {
  return firestore.collection("dashboard-campaigns").doc(project).get().then((doc) => {
    return doc.exists;
  }).catch(() => {
    return false;
  });
};

export const getProject = async (project: string) => {
  return firestore.collection("dashboard-campaigns").doc(project).get().then((doc) => {
    return doc.exists ? doc.id : "";
  }).catch(() => {
    return "";
  });
};

export const badRequestResult = (req: functions.https.Request, res: functions.Response<any>): functions.Response<any> => {
  appInsights.defaultClient.trackEvent({ name: "badrequest", properties: { url: req.url, body: req.body } });
  return res.status(400).send("Bad Request");
};

export const getGoogleAnalyticsId = async (project: string): Promise<CampaignAnalytics> => {
  const doc = await firestore.collection("dashboard-campaigns").doc(project).get();
  if (!doc.exists) {
    const error = new functions.https.HttpsError("not-found", "Project not found");
    appInsights.defaultClient.trackException({ exception: error, properties: { project: project } });
    throw error;
  }
  return doc.data()?.analytics as CampaignAnalytics;
};

export const validateEmail = (email: string): boolean => {
  const re = /\S+@\S+\.\S+/;
  return re.test(email);
};

export const getDefaultLanguage = () => {
  return supportedLanguages[0];
};

export const getPaymentMethod = async (project: string): Promise<PaymentMethod> => {
  const doc = await firestore.collection("dashboard-campaigns").doc(project).get();
  if (!doc.exists) {
    const error = new functions.https.HttpsError("not-found", "Payment method not found");
    appInsights.defaultClient.trackException({ exception: error, properties: { project: project } });
    throw error;
  }

  return doc.data()?.paymentInfo?.paymentMethod;
};
