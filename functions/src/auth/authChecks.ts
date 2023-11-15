import { AuthData } from "firebase-functions/lib/common/providers/tasks";
import * as functions from "firebase-functions";
import { getUserRolesFromDb } from "./auth";
import { logEvent } from "../helpers/errorLogging";

const isAdmin = async (auth: AuthData | undefined) => {
  try {
    if (!auth || !auth.uid) {
      return false;
    }

    const roles = await getUserRolesFromDb(auth.uid);
    return roles.includes("SuperAdmin");
  } catch (error: unknown) {
    logEvent("Failed to check if admin", { uid: auth?.uid, token: auth?.token }, true, error, "unauthenticated");
  }
};

export const checkIfAdmin = async (auth: AuthData | undefined) => {
  try {
    if (!isAdmin) {
      throw new functions.https.HttpsError("unauthenticated", "Unauthorized access");
    }
  } catch (error: unknown) {
    logEvent("Failed to check if admin", { uid: auth?.uid, token: auth?.token }, true, error, "unauthenticated");
  }
};

export const checkIfCorrectCampaign = async (auth: AuthData | undefined, campaignId: string) => {
  try {
    console.log(auth);
    console.log(campaignId);
    if (!auth || !auth.uid) {
      throw new functions.https.HttpsError("unauthenticated", "Unauthorized access");
    }

    if (!campaignId) {
      throw new functions.https.HttpsError("invalid-argument", "Campaign id is required");
    }

    const roles = await getUserRolesFromDb(auth.uid);
    if (roles.includes("SuperAdmin")) {
      return;
    }

    if (roles.includes(campaignId)) {
      return;
    }

    throw new functions.https.HttpsError("unauthenticated", "Unauthorized access");
  } catch (error: unknown) {
    logEvent("Failed to check if correct campaign", { uid: auth?.uid, token: auth?.token, campaignId }, true, error, "unauthenticated");
  }
};

export const checkIfLoggedIn = async (auth: AuthData | undefined) => {
  try {
    if (!auth || !auth.uid) {
      throw new functions.https.HttpsError("unauthenticated", "Unauthorized access");
    }
  } catch (error: unknown) {
    logEvent("Failed to check if logged in", { uid: auth?.uid, token: auth?.token }, true, error, "unauthenticated");
  }
};
