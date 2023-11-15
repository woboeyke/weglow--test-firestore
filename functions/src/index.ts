import * as untypedAppInsights from "applicationinsights";
export const appInsights = untypedAppInsights as typeof import("applicationinsights");
// Must be initially hardcoded, otherwise firebase wont deploy
let connectionString = "InstrumentationKey=7ea5ad2d-2a5a-4172-ac24-1cc4921dbcf6;IngestionEndpoint=https://westeurope-5.in.applicationinsights.azure.com/;LiveEndpoint=https://westeurope.livediagnostics.monitor.azure.com/";
if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
  connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
}
appInsights.setup(connectionString)
  .setAutoDependencyCorrelation(true)
  .setAutoCollectRequests(true)
  .setAutoCollectPerformance(true, true)
  .setAutoCollectExceptions(true)
  .setAutoCollectDependencies(true)
  .setAutoCollectConsole(true)
  .setUseDiskRetryCaching(true)
  .setSendLiveMetrics(process.env.AZURE_SEND_LIVE_METRICS == "1" ? true : false)
  .setAutoCollectHeartbeat(true)
  .setDistributedTracingMode(appInsights.DistributedTracingModes.AI_AND_W3C)
  .start();

import * as admin from "firebase-admin";

// FireBase
admin.initializeApp();

import * as helpers from "./helpers/helpers";
import * as universal from "./universal";
import * as auth from "./auth/auth";
import * as analytics from "./analytics/analytics";
import * as content from "./content/content";
import * as candles from "./candles/candles";
import * as translations from "./translations/translations";
import * as blob from "./blob/blob";
import * as certificate from "./certificate/certificate";

// Admin
import * as campaigns from "./admin/campaigns";

module.exports = {
  ...helpers,
  ...universal,
  ...auth,
  ...analytics,
  ...campaigns,
  ...content,
  ...candles,
  ...translations,
  ...blob,
  ...certificate,
};
