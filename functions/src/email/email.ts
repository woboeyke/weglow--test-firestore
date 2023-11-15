import * as functions from "firebase-functions";
import * as nodemailer from "nodemailer";
import { appInsights } from "../index";
import { logEvent } from "../helpers/errorLogging";

export const mailTransport = nodemailer.createTransport({
  host: "send.one.com",
  port: 465,
  secure: true,
  auth: {
    user: "hello@weglow.world",
    pass: "WeGlow2023",
  },
});

export const sendEmail = (to: string, subject: string, text: string) => {
  const mailOptions = {
    from: "hello@weglow.world",
    to: to,
    subject: subject,
    html: text,
  };

  return new Promise((resolve, reject) => {
    mailTransport.sendMail(mailOptions, (error: unknown, info: any) => {
      if (error) {
        appInsights.defaultClient.trackException({ exception: error as Error, properties: { to: to, subject: subject, text: text } });
        functions.logger.error(error);
        console.error("Error sending email:", error);
        reject(error);
      } else {
        logEvent("EmailSent", { to, subject });
        resolve(info);
      }
    });
  });
};
