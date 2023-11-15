import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { AddCandleDTO, Candle, CandleDto } from "../models/Candle";
import * as helpers from "../helpers/helpers";
import { sendEmail } from "../email/email";
import { Mail } from "../models/Content/Mail/Mail";
import { addCandleWithPayNL } from "./paynl/paynl";
import { PaymentMethod } from "../models/Payment";
import { addCandleWithPayconiq } from "./payconiq/payconiq";
import { Content } from "../models/Content/Content";
import { appInsights } from "../index";
import { checkIfCorrectCampaign } from "../auth/authChecks";
import { logEvent, logException } from "../helpers/errorLogging";

export { PaymentCompleteWithPayNL } from "./paynl/paynl";
export { PaymentCompleteWithPayconiq } from "./payconiq/payconiq";

export const getCandles = functions.runWith({ minInstances: 1 }).region("europe-west1").https.onCall(async (data, context) => {
  try {
    const { projectName, offset, pageSize } = data;

    if (!projectName) {
      throw new functions.https.HttpsError("invalid-argument", "Project name not provided");
    }

    const candles = await getCandlesFromDb(
      projectName,
      offset ? (offset > 0 || offset == -1 ? offset : 0) : 0,
      pageSize ? (pageSize > 0 ? pageSize: 20) : 20,
    );
    return candles;
  } catch (error: unknown) {
    logException(error, { projectName: data });
  }
});

export const recalculateTotalDonations = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    const campaignId = data.campaignId;
    await checkIfCorrectCampaign(context.auth, campaignId);

    const candles = await getCandlesFromDb(campaignId, 0, -1);

    const totalDonations = candles.totalCount;
    const totalDonated = candles.data.reduce((a, b) => {
      return a + b.flames;
    }, 0);

    const currentFlame = await getLatestCandle(campaignId);

    const firestore = admin.firestore();
    await firestore.collection("projects").doc(campaignId).set({
      info: {
        __total: totalDonations,
        __totalflame: totalDonated,
        __currentflame: currentFlame,
      },
    }, { merge: true });

    logEvent("TotalDonationsRecalculated", { campaignId, totalDonations, totalDonated });

    return { totalDonations: totalDonations, totalDonated: totalDonated };
  } catch (error: unknown) {
    logException(error, { campaignId: data?.campaignId });
  }
});

export const getLatestCandle = async (projectName: string) => {
  try {
    const candleId = await admin.firestore().collection("projects").doc(projectName).collection("candles").get().then((querySnapshot) => {
      const candles: Candle[] = [];
      querySnapshot.forEach((doc) => {
        doc.data().candles.forEach((candle: Candle) => {
          candles.push(candle);
        });
      });
      return candles.reduce((latest, obj) => {
        return obj.date > latest.date ? obj : latest;
      });
    });

    return candleId;
  } catch (error: unknown) {
    return logException(error, { projectName });
  }
};

// Has pagination. If all candles are needed, set pageSize to -1
export const getCandlesFromDb = async (projectName: string, offset: number, pageSize: number) => {
  try {
    const candles = await admin.firestore().collection("projects").doc(projectName).collection("candles").get().then((querySnapshot) => {
      let candles: Candle[] = [];
      querySnapshot.forEach((doc) => {
        doc.data().candles.forEach((candle: Candle) => {
          candles.push(candle);
        });
      });
      const totalCount = candles.length;
      const candleLocations = candles.map((c) => {
        return [c.lat, c.lng];
      }, []);

      candles.sort((a, b) => {
        return b.date.toDate().getTime() - a.date.toDate().getTime();
      });

      if (pageSize != -1) {
        candles = candles.slice(offset, (offset+1)*pageSize);
      }

      const candlesDto: CandleDto[] = [];
      candles.forEach((candle) => {
        candlesDto.push({
          number: candle.number,
          name: candle.anonymous ? "" : candle.name,
          description: candle.description,
          lat: candle.lat,
          lng: candle.lng,
          flames: candle.flames,
          formattedDate: candle.date.toDate().toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" }), // dd/mm/yyyy
        });
      });

      return {data: candlesDto, locations: candleLocations, totalCount};
    });

    return candles;
  } catch (error: unknown) {
    return logException(error, { projectName });
  }
};

export const AddCandle = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    let { lat, lng, flames, description, name, email, anonymous, project, language } = data as AddCandleDTO;
    if (!lat || !lng || !flames || !name || !project || !helpers.projectExists(project)) {
      throw new functions.https.HttpsError("invalid-argument", "Invalid arguments");
    }

    if (description) {
      description = description.substring(0, 140);
    }

    name = name.substring(0, 50);

    if (flames < 5) {
      flames = 5;
    }

    flames = Math.round(flames);

    const paymentMethod = await helpers.getPaymentMethod(project);
    await admin.firestore().collection("dashboard-campaigns").doc(project).get().then((doc) => {
      if (!(doc.data()?.content as Content).buyCandle.allowAnonymousDonations) {
        anonymous = false;
      }
    });

    try {
      if (paymentMethod == PaymentMethod.PayNL) {
        console.log("Payment method is PayNL");
        return await addCandleWithPayNL(
          {
            lat, lng, flames, description, name, email, anonymous, project, language,
          } as AddCandleDTO,
          context.rawRequest.ip ?? "127.0.0.1",
        );
      } else if (paymentMethod == PaymentMethod.Payconiq) {
        console.log("Payment method is Payconiq");
        return await addCandleWithPayconiq(
          {
            lat, lng, flames, description, name, email, anonymous, project, language,
          } as AddCandleDTO,
        );
      }
    } catch (error: unknown) {
      throw new functions.https.HttpsError("invalid-argument", (error as Error).message);
    }

    throw new functions.https.HttpsError("invalid-argument", "Invalid project");
  } catch (error: unknown) {
    logException(error, { candle: data });
  }
});

export const startSendEmail = async (email: string, project: string, language?: string, paymentId?: string, paymentAmount?: number) => {
  try {
    if (!language) {
      console.log("No language provided, using default language");
      language = helpers.getDefaultLanguage();
    }

    if (!email) {
      return;
    } else if (!helpers.validateEmail(email)) {
      console.log("Invalid email provided, not sending email");
      return;
    }

    const firestore = admin.firestore();
    const doc = await firestore.collection("dashboard-campaigns").doc(`${project}`).get();
    if (!doc.exists) {
      console.log("Project does not exist, not sending email");
      return;
    }

    const content = doc.data()?.content as Content;
    if (!content) {
      console.log("Content does not exist, not sending email");
      return;
    }

    const mail = content.mail as Mail;
    if (!mail) {
      console.log("Mail property does not exist, not sending email");
      return;
    }

    if (mail.sendEmailOnPayment) {
      const emailSubject = mail.emailSubject.find((x) => x.locale === language);
      const emailHtml = mail.emailHtml.find((x) => x.locale === language);
      if (!emailSubject || !emailHtml) {
        console.log("Email subject or html does not exist, not sending email");
        return;
      }

      await sendEmail(email, emailSubject.value, emailHtml.value);
    }

    if (mail.sendCertificateEmailOnPayment && content.buyCandle.fiscalCertificateEnabled) {
      if (!paymentAmount) {
        console.log("Payment amount not provided, not sending email");
        appInsights.defaultClient.trackException({ exception: new Error("Payment amount not provided"), properties: { email: email, project: project, language: language, paymentId: paymentId } });
        return;
      } else if (paymentAmount < 40) {
        console.log("Payment amount is less than 40, not sending email");
        return;
      }

      const certificateEmailSubject = mail.certificateEmailSubject.find((x) => x.locale === language);
      const certificateEmailHtml = mail.certificateEmailHtml.find((x) => x.locale === language);
      if (!certificateEmailSubject || !certificateEmailHtml) {
        console.log("Certificate email subject or html does not exist, not sending email");
        return;
      }

      const isTest = process.env.PAYCONIQ_TESTMODE;
      let url = `https://${project}.weglow.world/certificate`;
      const customURL = doc.data()?.customURL?.replace(/\/+$/, "") ?? "";

      if (customURL && customURL.length > 0) {
        url = `${customURL}/certificate`;
      } else if (isTest == "1") {
        url = "http://localhost:9000/certificate";
      }

      const html = certificateEmailHtml.value.replace("{{ paymentId }}", paymentId ?? "").replace("{{ url }}", url);

      await sendEmail(email, certificateEmailSubject.value, html);
    }
  } catch (error: unknown) {
    logException(error, { email, project, language, paymentId });
  }
};

export const CheckIfPaid = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    const orderId = data.orderId;

    if (!orderId) {
      throw new functions.https.HttpsError("invalid-argument", "No orderId provided");
    }

    const firestore = admin.firestore();
    const doc = await firestore.collection("payments/paynl/payed").doc(`${orderId}`).get();
    if (doc.exists) {
      return true;
    }

    return false;
  } catch (error: unknown) {
    logException(error, { orderId: data?.orderId });
  }
});
