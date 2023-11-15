
import { appInsights } from "../index";
import * as functions from "firebase-functions";

export const logException = (error: unknown, properties: object | undefined = undefined, message: string | undefined = undefined, code: functions.https.FunctionsErrorCode = "internal", severity: number | undefined = undefined): never => {
  appInsights.defaultClient.trackException({ exception: error as Error, properties, severity });
  functions.logger.error(error);
  if (process.env.ENVI == "Local") {
    console.error(error);
  }

  if (error instanceof functions.https.HttpsError) {
    throw error;
  }

  if (message) {
    throw new functions.https.HttpsError(code, message);
  }

  throw error;
};

// eslint-disable-next-line @typescript-eslint/no-inferrable-types
export const logEvent = (name: string, properties: object | undefined = undefined, throwError: boolean = false, error: unknown = undefined, code: functions.https.FunctionsErrorCode = "internal"): void => {
  appInsights.defaultClient.trackEvent({ name, properties });
  functions.logger.info(name);
  if (process.env.ENVI == "Local") {
    console.log(name);
  }

  if (throwError) {
    if (error && error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw new functions.https.HttpsError(code, name);
  }
};

export const logTrace = (message: string, properties: object | undefined = undefined): void => {
  appInsights.defaultClient.trackTrace({ message, properties });
  functions.logger.info(message);
  if (process.env.ENVI == "Local") {
    console.log(message);
  }
};
