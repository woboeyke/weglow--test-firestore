import { logException } from "../helpers/errorLogging";
import * as functions from "firebase-functions";

export const validateUser = (user: any) => {
  try {
    if (!user.email) {
      throw new functions.https.HttpsError("invalid-argument", "Email is required");
    }

    if (!user.displayName) {
      user.displayName = "user";
    }

    if (!user.photoURL) {
      delete user.photoURL;
    } else if (!validPhotoURL(user.photoURL)) {
      throw new functions.https.HttpsError("invalid-argument", "Photo URL is invalid");
    }

    return user;
  } catch (error: unknown) {
    logException(error, { user });
  }
};

const validPhotoURL = (photoURL: string | null | undefined) => {
  return (photoURL && photoURL.length > 0);
};
