import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { appInsights } from "./index";
import { Candle, TempCandle } from "./models/Candle";
import { logException, logTrace } from "./helpers/errorLogging";
import { InfoDoc } from "./models/InfoDoc";

const firestore = admin.firestore();

export const Ping = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      res.status(200).send("pong, environment:" + process.env.ENVI);
    } catch (error: unknown) {
      res.status(400).send("Error: " + JSON.stringify(error));
    }
  });

/**
 * Handles payment synchronization for a specific payment platform.
 *
 * @param {string} platformName - The name of the payment platform (e.g., "paynl").
 * @return {Promise<unknown>} A promise that resolves when all batch writes are completed.
 */
async function handlePayment(platformName: string): Promise<unknown> {
  try {
    logTrace("Running handlePayment", { platformName });
    const paymentDocs = await firestore
      .collection("payments")
      .doc(platformName)
      .collection("payed")
      .get();
    const projects: { [key: string]: any[] } = {};

    paymentDocs.forEach((doc) => {
      const candle = doc.data() as TempCandle;
      const projectId = candle.project;
      if (projects[projectId]) {
        projects[projectId].push({ id: doc.id, candle });
      } else {
        projects[projectId] = [{ id: doc.id, candle }];
      }
    });

    const promises: Promise<unknown>[] = [];

    for (const projectId in projects) {
      const infoDocRef = firestore.collection("projects").doc(projectId);
      logTrace("Using project in handlePayment", { projectId, platformName });
      const infoDoc = await infoDocRef.get();
      let { __total, __totalflame, __current, __currentflame } = infoDoc.data()
        ?.info as InfoDoc;

      const batch = firestore.batch();

      await Promise.all(projects[projectId].map(
        async ({ id: payedObjectId, candle }: { id: string; candle: TempCandle }) => {
          const { lat, lng, flames, email, description, name, date } =
            candle as Candle;
          const candleGroupID = Math.floor(__total / 1000);
          const candleDocRef = firestore
            .collection("projects")
            .doc(projectId)
            .collection("candles")
            .doc(candleGroupID.toString());

          const candleData = {
            number: __total + 1,
            orderId: payedObjectId,
            lat,
            lng,
            flames,
            email: email ?? "",
            description,
            name,
            date,
          };

          appInsights.defaultClient.trackTrace({
            message: `Candle ${payedObjectId} synced`,
            properties: {
              candleId: payedObjectId,
              projectId: projectId,
              platformName: platformName,
            },
          });

          if (candleGroupID * 1000 === __total) {
            batch.set(candleDocRef, { candles: [candleData] });
          } else {
            batch.update(candleDocRef, {
              candles: admin.firestore.FieldValue.arrayUnion(candleData),
            });
          }

          // Update project info
          __total += 1;
          __totalflame += flames;
          __current += 1;
          __currentflame += flames;

          // Move document data from payed to to payedreference
          const docData = (await firestore.doc(`payments/${platformName}/payed/${payedObjectId}`).get()).data();
          batch.set(firestore.doc(`payments/${platformName}/payedreference/${payedObjectId}`), docData);
          batch.delete(firestore.doc(`payments/${platformName}/payed/${payedObjectId}`));
        }
      ));

      batch.update(infoDocRef, {
        info: {
          __total,
          __totalflame,
          __current,
          __currentflame,
        },
      });

      promises.push(batch.commit());
    }

    return Promise.all(promises);
  } catch (error: unknown) {
    logException(
      error,
      { platformName: platformName },
      undefined,
      "internal",
      4
    );
  }
}

/**
 * Handles cache clearing for a specific payment platform.
 *
 * @param {string} platformName - The name of the payment platform (e.g., "paynl").
 * @return {Promise<unknown>} A promise that resolves when all batch writes are completed.
 */
async function clearCache(platformName: string): Promise<unknown> {
  try {
    logTrace("Running clearCache", { platformName });
    const cacheDocs = await firestore
      .collection("payments")
      .doc(platformName)
      .collection("cache")
      .get();
    const promises: Promise<unknown>[] = [];

    const now = new Date();

    cacheDocs.forEach((doc) => {
      const candle = doc.data() as Candle;
      logTrace("Using candle in clearCache", { candle: candle.number });
      if (!candle?.date) {
        const date = candle.date.toDate();

        // If the date is older than 1 day, delete the document
        if (now.getTime() - date.getTime() > 86400000) {
          promises.push(
            firestore
              .collection("payments")
              .doc(platformName)
              .collection("cache")
              .doc(doc.id)
              .delete()
          );
        }
      }
    });

    if (promises.length > 0) {
      appInsights.defaultClient.trackTrace({
        message: "Cache cleared",
        properties: {
          platformRef: platformName,
          amount: promises.length,
        },
      });
    }

    return Promise.all(promises);
  } catch (error: unknown) {
    logException(
      error,
      { platformName: platformName },
      undefined,
      "internal",
      3
    );
  }
}

const runSyncCandles = async () => {
  try {
    const paymentTypes = ["paynl", "payconiq", "stripe"];
    for (const paymentType of paymentTypes) {
      await handlePayment(paymentType);
      await clearCache(paymentType);
    }
  } catch (error: unknown) {
    logException(error, undefined, undefined, "internal", 4);
  }
};

export const SyncCandles = functions
  .region("europe-west1")
  .pubsub.schedule("every 5 minutes")
  .onRun(async () => {
    appInsights.defaultClient.trackTrace({
      message: "SyncCandles function started",
    });

    await runSyncCandles();
  });
