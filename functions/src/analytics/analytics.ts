import * as functions from "firebase-functions";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { countryToAlpha2 } from "country-to-iso";
import { getGoogleAnalyticsId } from "../helpers/helpers";
import { email, privateKey } from "../secrets/analytics";
import * as admin from "firebase-admin";
import { google } from "@google-analytics/data/build/protos/protos";
import { checkIfCorrectCampaign } from "../auth/authChecks";
import { logEvent, logException, logTrace } from "../helpers/errorLogging";

export { createNewAnalyticsProperty } from "./properties";

const analyticsDataClient = new BetaAnalyticsDataClient({
  credentials: {
    client_email: email,
    private_key: privateKey,
  },
});

export const getCurrentAnalytics = async (analyticId: string) => {
  try {
    if (!analyticId) {
      throw new functions.https.HttpsError("invalid-argument", "GetCurrentAnalytics: Analytics ID not provided");
    }

    const [response] = await analyticsDataClient.runReport({
      property: `properties/${analyticId}`,
      dateRanges: [
        {
          startDate: "2005-01-01",
          endDate: "today",
        },
      ],
      metrics: [{ name: "activeUsers" }],
    });

    const views = response?.rows?.[0]?.metricValues?.[0]?.value;
    const parsedViews = typeof views === "string" ? parseFloat(views) : 0;

    logEvent("GetCurrentAnalytics", { analyticId: analyticId, views: parsedViews.toString() });

    return parsedViews;
  } catch (error: unknown) {
    return logException(error, { analyticId: analyticId }, "Error getting current analytics");
  }
};

export const getCurrentAnalyticsWithChange = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    const campaignId = data?.campaignId;
    await checkIfCorrectCampaign(context.auth, campaignId);

    const analytics = await getGoogleAnalyticsId(campaignId);

    const endDateLastWeek = new Date();
    endDateLastWeek.setDate(endDateLastWeek.getDate() - 7);

    const [[response], [response2]] = await Promise.all([
      analyticsDataClient.runReport({
        property: `properties/${analytics.propertyId}`,
        dateRanges: [
          {
            startDate: "2005-01-01",
            endDate: "today",
          },
        ],
        metrics: [{ name: "activeUsers" }],
      }),
      analyticsDataClient.runReport({
        property: `properties/${analytics.propertyId}`,
        dateRanges: [
          {
            startDate: "2005-01-01",
            endDate: endDateLastWeek.toISOString().split("T")[0],
          },
        ],
        metrics: [{ name: "activeUsers" }],
      }),
    ]);

    const currentActiveUsers = response?.rows?.[0]?.metricValues?.[0]?.value;
    const previousActiveUsers = response2?.rows?.[0]?.metricValues?.[0]?.value;

    const currentActiveUsersNum = typeof currentActiveUsers === "string" ? parseFloat(currentActiveUsers) : 0;
    const previousActiveUsersNum = typeof previousActiveUsers === "string" ? parseFloat(previousActiveUsers) : 0;

    const change = previousActiveUsersNum !== 0 ? (currentActiveUsersNum - previousActiveUsersNum) / previousActiveUsersNum : 0;

    logTrace("GetCurrentAnalyticsWithChange", { currentActiveUsers: currentActiveUsersNum.toString(), change: change.toString() });

    return { current: currentActiveUsersNum, change: change };
  } catch (error: unknown) {
    logException(error, { analyticsId: data?.analyticsId }, "Error getting current analytics with change");
  }
});

export const getCurrentAnalyticsGroupedByCountry = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    if (!data || !data.campaignId) {
      throw new functions.https.HttpsError("invalid-argument", "Campaign ID not provided");
    }
    const campaignId = data?.campaignId;
    await checkIfCorrectCampaign(context.auth, campaignId);

    const analytics = await getGoogleAnalyticsId(campaignId);

    const [response] = await analyticsDataClient.runReport({
      property: `properties/${analytics.propertyId}`,
      dateRanges: [
        {
          startDate: "2005-01-01",
          endDate: "today",
        },
      ],
      metrics: [{ name: "activeUsers" }],
      dimensions: [{ name: "country" }],
    });

    if (!response.rows) {
      throw new functions.https.HttpsError("internal", "No data found");
    }

    //    {
    //      dimensionValues: [ { value: "Belgium", oneValue: "value" } ],
    //      metricValues: [ { value: "365", oneValue: "value" } ]
    //    }
    // const result: { country: string, activeUsers: number }[] = response.rows?.map((row: any) => {
    //   return { country: row.dimensionValues[0].value, activeUsers: parseFloat(row.metricValues[0].value) };
    // });
    const result: { country: string, activeUsers: number }[] = response.rows?.map((row: google.analytics.data.v1beta.IRow) => {
      if (!row.dimensionValues || !row.metricValues || !row.dimensionValues[0]?.value || !row.metricValues[0]?.value) {
        throw new functions.https.HttpsError("internal", "No data found");
      }

      return { country: countryToAlpha2(row.dimensionValues[0].value) ?? "other", activeUsers: parseFloat(row.metricValues[0].value) };
    });

    logEvent("GetCurrentAnalyticsGroupedByCountry", { analyticsId: analytics.propertyId, result: JSON.stringify(result) });

    return result;
  } catch (error: unknown) {
    logException(error, { analyticsId: data?.analyticsId }, "Error getting current analytics grouped by country");
  }
});

export const getTotalFlames = functions.region("europe-west1").https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Unauthorized access");
  }

  const campaignId = data?.campaignId;

  await checkIfCorrectCampaign(context.auth, campaignId);

  return await getTotalFlamesFromDb(campaignId);
});

export const getTotalFlamesFromDb = async (campaignId: string) => {
  try {
    if (!campaignId) {
      logEvent("GetTotalFlamesFromDb: No campaignId provided");
      return 0;
    }
    const firestore = admin.firestore();

    const doc = await firestore.collection("projects").doc(campaignId).get();
    if (!doc.exists) {
      throw new functions.https.HttpsError("not-found", `GetTotalFlamesFromDb: Campaign (${campaignId}) info not found`);
    }

    return doc.data()?.info?.__totalflame as number;
  } catch (error: unknown) {
    logException(error, { campaignId }, "Error getting total flames");
  }
};

export const getCountdown = async (campaignId: string) => {
  try {
    if (!campaignId) {
      logEvent("GetCountdown: No campaignId provided");
      return 0;
    }

    const firestore = admin.firestore();
    const doc = await firestore.collection("dashboard-campaigns").doc(`${campaignId}`).get();

    if (!doc.exists) {
      throw new functions.https.HttpsError("not-found", "Campaign not found");
    }

    const endDate = doc.data()?.endDate as admin.firestore.Timestamp;

    const days = Math.floor((endDate.toDate().getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    const hours = Math.floor(((endDate.toDate().getTime() - new Date().getTime()) % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return {
      days: days < 0 ? 0 : days,
      hours: hours < 0 ? 0 : hours,
    };
  } catch (error: unknown) {
    logException(error, { campaignId }, "Error getting countdown");
  }
};
