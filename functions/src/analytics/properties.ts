import { getAllAdmins } from "../auth/auth";
import { appInsights } from "../index";
import { AnalyticsAdminServiceClient } from "@google-analytics/admin/build/src/v1alpha";
import { email, privateKey } from "../secrets/analytics";
import { logEvent, logException, logTrace } from "../helpers/errorLogging";
type MyAnalyticsAdminServiceClient = import("@google-analytics/admin").v1alpha.AnalyticsAdminServiceClient;

let cachedFirstAccountName: string | null | undefined = null;
const adminClient: MyAnalyticsAdminServiceClient = new AnalyticsAdminServiceClient({
  credentials: {
    client_email: email,
    private_key: privateKey,
  },
});

export const getFirstAccountName = async () => {
  if (cachedFirstAccountName !== null) {
    return cachedFirstAccountName;
  } else {
    logEvent("AnalyticsFirstAccountNameCacheMiss", { cachedFirstAccountName });
    const res = adminClient.listAccountsAsync();
    for await (const x of res) {
      if (!cachedFirstAccountName) {
        cachedFirstAccountName = x.name;
      }
    }
    return cachedFirstAccountName;
  }
};

export const createNewAnalyticsProperty = async (projectName: string, customURL?: string) => {
  try {
    const parent = await getFirstAccountName();

    if (!parent) {
      const error = new Error("No parent account found");
      appInsights.defaultClient.trackException({ exception: error, properties: { projectName: projectName, customURL: customURL } });
      throw error;
    }

    const property = await adminClient.createProperty({
      property: {
        parent: parent,
        displayName: projectName,
        currencyCode: "EUR",
        timeZone: "Europe/Brussels",
        industryCategory: "ONLINE_COMMUNITIES",
      },
    });

    if (!property || !property[0] || !property[0].name) {
      const error = new Error("No property created");
      appInsights.defaultClient.trackException({ exception: error, properties: { projectName: projectName, customURL: customURL } });
      throw error;
    }

    const propertyId = property[0].name.split("/")[1];

    let url = `https://${projectName}.weglow.world`;
    if (customURL) {
      url = customURL;
    }

    const webDataStream = await adminClient.createDataStream({
      parent: property[0].name,
      dataStream: {
        displayName: projectName,
        webStreamData: {
          defaultUri: url,
        },
        type: "WEB_DATA_STREAM",
      },
    });

    if (!webDataStream || !webDataStream[0] || !webDataStream[0].webStreamData || !webDataStream[0].webStreamData.measurementId) {
      const error = new Error("No web data stream created");
      appInsights.defaultClient.trackException({ exception: error, properties: { projectName: projectName, propertyId: propertyId, customURL: customURL } });
      throw error;
    }

    try {
      const googleSignalSettings = await adminClient.updateGoogleSignalsSettings({
        googleSignalsSettings: {
          name: `properties/${propertyId}/googleSignalsSettings`,
          state: "GOOGLE_SIGNALS_ENABLED",
          consent: "GOOGLE_SIGNALS_CONSENT_CONSENTED",
        },
        updateMask: {
          paths: ["state", "consent"],
        },
      });

      if (!googleSignalSettings || !googleSignalSettings[0] || !googleSignalSettings[0].name) {
        const error = new Error("No google signals settings created");
        appInsights.defaultClient.trackException({ exception: error, properties: { projectName: projectName, propertyId: propertyId, customURL: customURL } });
        throw error;
      }
    } catch (error: unknown) {
      appInsights.defaultClient.trackException({
        exception: error as Error,
        properties: {
          message: "Google signals is probably not enabled",
          error: error as Error,
          propertyId: propertyId,
        },
      });
    }

    const measurementId = webDataStream[0].webStreamData.measurementId;

    await addAdminsToAnalyticsProperty(propertyId);

    logEvent("NewAnalyticsPropertyCreated", { projectName, customURL, propertyId, measurementId });

    return { propertyId: propertyId, measurementId: measurementId };
  } catch (error: unknown) {
    return logException(error, { projectName, customURL });
  }
};

export const deleteAnalyticsProperty = async (propertyId: string) => {
  try {
    await adminClient.deleteProperty({
      name: `properties/${propertyId}`,
    });

    logEvent("AnalyticsPropertyDeleted", { propertyId });
  } catch (error: unknown) {
    logException(error, { propertyId });
    throw error;
  }
};

const addAdminsToAnalyticsProperty = async (propertyId: string) => {
  try {
    const admins = await getAllAdmins();

    if (!admins || admins.length === 0) {
      throw new Error("No admins found");
    }

    logTrace("Adding admins to analytics property", { propertyId, admins });

    const adminPromises = admins.map(async (admin) => {
      try {
        const request = {
          userLink: {
            emailAddress: admin,
            directRoles: ["predefinedRoles/admin"],
          },
        };

        await adminClient.createUserLink({
          parent: `properties/${propertyId}`,
          userLink: request.userLink,
          notifyNewUser: false,
        }).then(() => {
          logTrace("Admin added to analytics property", { propertyId, admin });
        }).catch((err: unknown) => {
          appInsights.defaultClient.trackException({
            exception: err as Error,
            properties: { propertyId: propertyId, admin: admin, admins: admins },
          });
        });
      } catch (err: unknown) {
        appInsights.defaultClient.trackException({
          exception: err as Error,
          properties: { propertyId: propertyId, admin: admin, admins: admins },
        });
      }
    });

    await Promise.all(adminPromises);

    logEvent("AdminsAddedToAnalyticsProperty", { propertyId, admins });
  } catch (error: unknown) {
    logException(error, { propertyId });
  }
};
