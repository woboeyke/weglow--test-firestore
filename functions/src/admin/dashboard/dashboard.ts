import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { getCountdown, getTotalFlamesFromDb } from "../../analytics/analytics";
import { Candle } from "../../models/Candle";
import { getPendingFiscalCertificates } from "../../certificate/certificate";
import { checkIfCorrectCampaign } from "../../auth/authChecks";
import { logException } from "../../helpers/errorLogging";

export const updateDashboardData = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    const campaignId = data?.campaignId;
    checkIfCorrectCampaign(context.auth, campaignId);

    const [totalFlames, countdown, lastDonation, pendingCertificates] = await Promise.all([
      getTotalFlamesFromDb(campaignId),
      getCountdown(campaignId),
      getLastDonationFromDb(campaignId),
      getPendingFiscalCertificates(campaignId),
    ]);

    return { totalFlames, countdown, lastDonation, pendingCertificates };
  } catch (error: unknown) {
    logException(error, { uid: context.auth?.uid }, "Error updating dashboard data");
  }
});

export const getLastDonationFromDb = async (projectName: string) => {
  const firestore = admin.firestore();

  return firestore
    .collection("projects")
    .doc(projectName)
    .collection("candles")
    .get().then((snapshot) => {
      const numericDocumentIds = snapshot.docs.map((doc) => parseInt(doc.id, 10)).filter((id) => !isNaN(id));
      const documentNumber = Math.max(...numericDocumentIds);
      const document = snapshot.docs.find((doc) => doc.id === documentNumber.toString());
      const lastDonation = (document?.data()?.candles as Candle[]).sort((a, b) => b.date.toMillis() - a.date.toMillis())[0];

      return lastDonation;
    }).catch((error) => {
      logException(error, { projectName: projectName }, "Error getting last donation");
    });
};
