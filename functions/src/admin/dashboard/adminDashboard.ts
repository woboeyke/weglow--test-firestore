import * as admin from "firebase-admin";
import { appInsights } from "../../index";
import * as functions from "firebase-functions";
import Axios from "axios";
import { azureInsightsApiKey, azureInsightsAppId } from "../../secrets/analytics";
import { getCurrentAnalytics } from "../../analytics/analytics";
import { checkIfAdmin } from "../../auth/authChecks";
import { logEvent, logException } from "../../helpers/errorLogging";
import { ICampaign } from "../../models/Campaign";

export const updateAdminDashboardData = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    await checkIfAdmin(context.auth);

    const [totalFlames, totalPageViews, totalExceptions] = await Promise.all([
      getAllTotalFlamesFromDb(),
      getTotalPageViewsFromDb(),
      getTotalExceptionsFromDb(),
    ]);

    return {
      totalFlames: totalFlames,
      totalPageViews: totalPageViews,
      totalExceptions: totalExceptions,
    };
  } catch (error: unknown) {
    logException(error, { data: data });
  }
});

export const getTotalExceptionsFromDb = async () => {
  try {
    const query = "exceptions | where timestamp >= ago(7d) | count";

    const url = `https://api.applicationinsights.io/v1/apps/${azureInsightsAppId}/query?query=${query}`;
    return await Axios.get(url, {
      headers: {
        "x-api-key": azureInsightsApiKey,
      },
    }).then((response) => {
      if (response.status === 200 && response.data.tables.length > 0) {
        return response.data.tables[0].rows[0][0] as number;
      } else {
        logEvent("Failed to retrieve exception data", { response: response });
        return 0;
      }
    }).catch((error) => {
      console.error("Appinsights errors: ", error);
      appInsights.defaultClient.trackException({ exception: error, properties: { url: url } });
      throw error;
    });
  } catch (error: unknown) {
    logException(error);
  }
};

export const getAllTotalFlamesFromDb = async () => {
  try {
    const firestore = admin.firestore();

    const campaigns = (await firestore.collection("dashboard-campaigns").listDocuments()).map((role) => role.id);

    const totalFlames = await Promise.all(
      campaigns.map(async (campaign) => {
        const doc = await firestore.collection("projects").doc(campaign).get();
        if (!doc.exists) {
          throw new functions.https.HttpsError("not-found", `GetAllTotalFlamesFromDb: Campaign (${campaign}) info not found`);
        }
        return doc.data()?.info?.__totalflame as number;
      })
    );

    return totalFlames.reduce((a, b) => a + b, 0);
  } catch (error: unknown) {
    logException(error);
  }
};

export const getTotalPageViewsFromDb = async () => {
  try {
    const firestore = admin.firestore();

    let analyticsIds = (await firestore.collection("dashboard-campaigns").get()).docs.map((doc) => (doc.data() as ICampaign).analytics.propertyId);
    analyticsIds = analyticsIds.filter((id) => !isNaN(Number(id)) && id !== "");

    const totalPageViews = await Promise.all(
      analyticsIds.map(async (analyticsId) => {
        try {
          return await getCurrentAnalytics(analyticsId);
        } catch (error: unknown) {
          return 0;
        }
      })
    );

    return totalPageViews.reduce((a, b) => a + b, 0);
  } catch (error: unknown) {
    logException(error);
  }
};
