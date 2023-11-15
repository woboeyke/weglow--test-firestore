import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { Certificate, CertificateStatus } from "../models/Certificate";
import { validCertificate } from "./validCertificate";
import { Candle } from "../models/Candle";
import { checkIfCorrectCampaign } from "../auth/authChecks";
import { logEvent, logException } from "../helpers/errorLogging";

export const RequestCertificate = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    const certificate = data.certificate as Certificate;
    const projectId = data.projectId as string;

    validCertificate(certificate);

    const firestore = admin.firestore();

    const documents = await firestore.collection("projects").doc(`${projectId}`).collection("candles").get().then((querySnapshot) => {
      const documents: admin.firestore.QueryDocumentSnapshot<admin.firestore.DocumentData>[] = [];
      querySnapshot.forEach((doc) => {
        if (isNaN(Number(doc.id))) {
          return;
        }
        documents.push(doc);
      });

      return documents;
    });

    // Check if candle was found and paid
    let candle: Candle | undefined;
    documents.forEach((doc) => {
      doc.data().candles.forEach((c: Candle) => {
        if (c.orderId === certificate.orderId) {
          candle = c;
        }
      });
    });

    if (!candle) {
      throw new functions.https.HttpsError("invalid-argument", "Candle/Payment not found");
    }

    // Check if email matches as validation
    if (candle.email !== certificate.email) {
      throw new functions.https.HttpsError("invalid-argument", "Email does not match");
    }

    // Check if certificates are enabled
    const projectDoc = await firestore.collection("dashboard-campaigns").doc(`${projectId}`).get();
    if (!projectDoc.exists) {
      throw new functions.https.HttpsError("invalid-argument", "Project not found");
    } else if (!projectDoc.data()?.content?.buyCandle?.fiscalCertificateEnabled) {
      throw new functions.https.HttpsError("invalid-argument", "Certificates are not enabled");
    }

    // set certificate properties
    certificate.bedrag = candle.flames;
    certificate.datum = candle.date.toDate().toISOString();
    certificate.status = CertificateStatus.Pending;

    // Check if certificate already exists
    const certificateDoc = await firestore.collection("projects").doc(`${projectId}`).collection("certifications").doc(`${certificate.orderId}`).get();
    if (certificateDoc.exists) {
      throw new functions.https.HttpsError("invalid-argument", "Certificate already exists");
    }

    await firestore.collection("projects").doc(`${projectId}`).collection("certifications").doc(`${certificate.orderId}`).set(certificate);

    logEvent("CertificateRequested", { orderId: certificate.orderId, projectId });

    return;
  } catch (error: unknown) {
    logException(error, { certificate: data?.certificate, projectId: data?.projectId });
  }
});

export const getAllCertificates = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    const campaignId = data.campaignId as string;
    await checkIfCorrectCampaign(context.auth, campaignId);

    const certificates: Certificate[] = await admin.firestore().collection("projects").doc(`${campaignId}`).collection("certifications").get().then((querySnapshot) => {
      const certificates: Certificate[] = [];
      querySnapshot.forEach((doc) => {
        const certificate = doc.data() as Certificate;
        certificate.datum = doc.data().datum.toDate().toISOString(); // is a Timestamp, but we want an iso string
        certificates.push(certificate);
      });

      return certificates;
    });

    return certificates;
  } catch (error: unknown) {
    logException(error, { campaignId: data?.campaignId });
  }
});

export const editCertificate = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    const certificate = data.certificate as Certificate;
    const campaignId = data.campaignId as string;
    await checkIfCorrectCampaign(context.auth, campaignId);

    validCertificate(certificate);

    await admin.firestore().collection("projects").doc(`${campaignId}`).collection("certifications").doc(`${certificate.orderId}`).set(certificate);

    logEvent("CertificateEdited", { orderId: certificate.orderId, campaignId });

    return;
  } catch (error: unknown) {
    logException(error, { certificate: data?.certificate, campaignId: data?.campaignId });
  }
});

export const deleteCertificate = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    const certificate = data.certificate as Certificate;
    const campaignId = data.campaignId as string;
    await checkIfCorrectCampaign(context.auth, campaignId);

    await admin.firestore().collection("projects").doc(`${campaignId}`).collection("certifications").doc(`${certificate.orderId}`).delete();

    logEvent("CertificateDeleted", { orderId: certificate.orderId, campaignId });

    return;
  } catch (error: unknown) {
    logException(error, { certificate: data?.certificate, campaignId: data?.campaignId });
  }
});

export const getPendingFiscalCertificates = async (projectName: string) => {
  const firestore = admin.firestore();

  return firestore
    .collection("projects")
    .doc(projectName)
    .collection("certificates")
    .get().then((snapshot) => {
      return snapshot.docs.map((doc) => doc.data() as Certificate).filter((certificate) => certificate.status === CertificateStatus.Pending).length;
    }).catch((error) => {
      logException(error, { projectName }, "Error getting pending fiscal certificates");
    });
};
