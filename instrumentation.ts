import type { Instrumentation } from "next";
import { errorFields, log } from "@/lib/log";

/**
 * Logs every unhandled server error (page render, route handler, Server
 * Action, middleware) as one structured line. The digest matches the one the
 * error page shows the user, so a reported error can be found in Vercel's
 * runtime logs. The query string and headers are left out: they can carry
 * OAuth codes and session cookies.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  log("error", "request.unhandled_error", {
    ...errorFields(error),
    method: request.method,
    path: request.path.split("?")[0],
    route: context.routePath,
    routeType: context.routeType,
  });
};
