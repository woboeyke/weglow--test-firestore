import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { appInsights } from "../index";
import { checkIfAdmin } from "./authChecks";
import { logEvent, logException } from "../helpers/errorLogging";
import { validateUser } from "./validateUser";

export const getAllRoles = functions.region("europe-west1").https.onCall(async (data, context) => {
  await checkIfAdmin(context.auth);

  try {
    return getAllRolesFromDb();
  } catch (error: unknown) {
    logException(error, { exception: error as Error });
  }
});

export const getAllAdmins = async () => {
  try {
    const firestore = admin.firestore();
    const roles = await firestore.collection("roles").listDocuments();
    const adminPromises = roles.map(async (doc) => {
      const docData = await doc.get().then((doc) => doc.data());
      if (!docData || docData?.role?.SuperAdmin && !docData?.email) {
        return undefined;
      }
      return docData.email as string ?? undefined;
    });

    const admins = await Promise.all(adminPromises);

    const filteredAdmins = admins.filter((admin) => admin !== undefined);

    return filteredAdmins;
  } catch (error: unknown) {
    logException(error);
  }
};

export const getAllRolesFromDb = async (dontIncludeAdmin = false) => {
  try {
    const firestore = admin.firestore();
    const roles = await Promise.all((await firestore.collection("dashboard-campaigns").listDocuments()).map(async (doc) => {
      const displayName = await doc.get().then((doc) => doc.data()?.displayName);
      return {
        label: displayName,
        value: doc.id,
      };
    }));

    if (dontIncludeAdmin) {
      return roles;
    }

    return [{ label: "Super Admin", value: "SuperAdmin" }, ...roles];
  } catch (error: unknown) {
    return logException(error);
  }
};

export const getUserRoles = functions.region("europe-west1").https.onCall(async (data, context) => {
  await checkIfAdmin(context.auth);

  try {
    const { uid } = data;

    try {
      const claims = (await admin.auth().getUser(uid)).customClaims;
      return claims ? claims : {};
    } catch (error: unknown) {
      appInsights.defaultClient.trackException({ exception: error as Error, properties: { uid } });
    }
    return;
  } catch (error: unknown) {
    logException(error, { uid: data.uid });
  }
});

export const getUserRolesFromDb = async (uid: string): Promise<string[]> => {
  try {
    if (!uid) {
      throw new functions.https.HttpsError("invalid-argument", "Uid is required");
    }

    const claims = (await admin.auth().getUser(uid)).customClaims ?? {};

    const roles = Object.keys(claims).filter((key) => {
      if ((!claims) || (typeof claims[key] !== "boolean")) {
        return false;
      }

      return claims[key] === true;
    });
    if (roles.find((role) => role === "SuperAdmin")) {
      return (await getAllRolesFromDb(true)).map((role) => role.value);
    }
    return roles;
  } catch (error: unknown) {
    logException(error, { uid });
    return [];
  }
};

export const updateUser = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    const { uid, displayName, email, photoURL, customClaims } = data;
    if (uid !== context.auth?.uid) {
      await checkIfAdmin(context.auth);
    }

    try {
      await admin.auth().updateUser(uid, validateUser({
        displayName: displayName,
        email: email,
        photoURL: photoURL,
      }));

      logEvent("UserUpdated", { uid, displayName, email, photoURL });

      return await updateRoles(uid, customClaims);
    } catch (error) {
      logException(error, { error }, "Error updating user");
    }
  } catch (error: unknown) {
    logException(error, { uid: data.uid });
  }
});

export const deleteUser = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    await checkIfAdmin(context.auth);
    const { uid } = data;
    const firestore = admin.firestore();

    try {
      await admin.auth().deleteUser(uid);

      logEvent("UserDeleted", { uid });

      return await firestore.collection("roles").doc(uid).delete();
    } catch (error) {
      logException(error, { error }, "Error deleting user");
    }
  } catch (error: unknown) {
    logException(error, { uid: data.uid });
  }
});

export const createUser = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    await checkIfAdmin(context.auth);
    const { email, password, displayName, photoURL, customClaims } = data;

    try {
      const userRecord = await admin.auth().createUser(validateUser({
        email: email,
        password: password,
        displayName: displayName,
        photoURL: photoURL,
      }));

      await updateRoles(userRecord.uid, customClaims);

      logEvent("UserCreated", { uid: userRecord.uid, displayName, email, photoURL });

      return;
    } catch (error) {
      logException(error, { error }, "Error creating user");
    }
  } catch (error: unknown) {
    logException(error, { uid: data.uid });
  }
});

export const getAllUsers = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    await checkIfAdmin(context.auth);
    return listAllUsers(data)
      .then((users: any) => {
        return users;
      })
      .catch((error: unknown) => {
        logException(error, { error }, "Error listing users");
      });
  } catch (error: unknown) {
    logException(error, { data });
  }
});

const listAllUsers = async (nextPageToken: any) => {
  try {
    const users: any[] = [];

    const recursiveListUsers: any = async (token: any) => {
      const listUsersResult = await admin.auth()
        .listUsers(1000, token);
      listUsersResult.users.forEach((userRecord) => {
        users.push({
          uid: userRecord.uid,
          email: userRecord.email,
          displayName: userRecord.displayName,
          photoURL: userRecord.photoURL,
          customClaims: userRecord.customClaims,
        });
      });
      if (listUsersResult.pageToken) {
        return await recursiveListUsers(listUsersResult.pageToken);
      } else {
        return users;
      }
    };

    return await recursiveListUsers(nextPageToken);
  } catch (error: unknown) {
    logException(error, { nextPageToken });
  }
};

const updateRoles = async (uid: any, roles: { label: string, value: string }[]) => {
  try {
    if (!roles) {
      roles = [];
    }
    const newRoles: any = {};
    const firestore = admin.firestore();

    roles.forEach((role) => {
      newRoles[role.value] = true;
    });

    (await getAllRolesFromDb()).forEach((role) => {
      if (!newRoles[role.value]) {
        newRoles[role.value] = false;
      }
    });

    await admin.auth().setCustomUserClaims(uid, newRoles);

    const doc = await firestore.collection("roles").doc(uid).get();
    if (!doc.exists) {
      return await firestore.collection("roles").doc(uid).set({
        email: (await admin.auth().getUser(uid)).email,
        role: newRoles,
      });
    } else {
      return await firestore.collection("roles").doc(uid).update({
        role: newRoles,
      });
    }
  } catch (error: unknown) {
    logException(error, { uid });
  }
};
// updateRoles("O5HogSfCR6b1zGlOvx4bgUfvAof1", [{ label: "Super Admin", value: "SuperAdmin" }]);
