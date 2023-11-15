import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { Content, ContentDTO } from "../models/Content/Content";
import Axios from "axios";
import { appInsights } from "../index";
import { googleFontsApiKey, googleFontsApiUrl } from "../secrets/googleFonts";
import { InfoDoc } from "../models/InfoDoc";
import { logException, logTrace } from "../helpers/errorLogging";
import { ICampaign } from "../models/Campaign";

// Important: Min 1 instance
export const getAllContent = functions.runWith({ minInstances: 1 }).region("europe-west1").https.onCall(async (data, context) => {
  try {
    const projectName = data;

    if (!projectName) {
      const error = new functions.https.HttpsError("invalid-argument", "Project name not provided");
      appInsights.defaultClient.trackException({ exception: error });
      throw error;
    }

    const content: ContentDTO = await admin.firestore().collection("dashboard-campaigns").doc(projectName).get().then((doc) => {
      const endDate = doc.data()?.endDate as admin.firestore.Timestamp;
      const content = doc.data()?.content as Content;
      content.countdownDate = endDate.toDate().toISOString();

      return content;
    });

    content.totalDonations = await admin.firestore().collection("projects").doc(projectName).get().then((doc) => {
      return (doc.data()?.info as InfoDoc)?.__total as number;
    });

    content.totalDonated = await admin.firestore().collection("projects").doc(projectName).get().then((doc) => {
      return (doc.data()?.info as InfoDoc)?.__totalflame as number;
    });

    content.analyticsId = await admin.firestore().collection("dashboard-campaigns").doc(projectName).get().then((doc) => {
      return (doc.data() as ICampaign)?.analytics.measurementId as string;
    });

    logTrace(`Content retrieved for project ${projectName}`, { projectName });

    return content;
  } catch (error: unknown) {
    logException(error, { projectName: data });
  }
});

export const searchFont = functions.region("europe-west1").https.onCall(async (data, context) => {
  const fontName = data as string;
  const normalizedFontName = fontName.trim().toLowerCase();

  return await Axios.get(`${googleFontsApiUrl}?key=${googleFontsApiKey}&capability=WOFF2`).then((response) => {
    return response.data.items.filter((item: any) => {
      return (item.family as string).toLowerCase().includes(normalizedFontName);
    }).map((item: any) => {
      return {
        label: item.family,
        value: item.menu,
      };
    });
  }).catch((error) => {
    logException(error, { fontName: fontName }, "Font not found", "not-found");
  });
});
