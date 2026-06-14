import type { Scope } from "@omriashke/dynamico-core";
import * as libphonenumber from "libphonenumber-js";

/**
 * npm modules and synthetic packages available during worker validation when
 * listed in allowedScope. Built inside the worker thread (not passed via
 * workerData) because module objects are not structured-cloneable.
 */
export function validationHostScope(allowedScope?: readonly string[]): Scope {
  if (!allowedScope?.length) return {};
  const scope: Scope = {};
  if (allowedScope.includes("libphonenumber-js")) {
    scope["libphonenumber-js"] = libphonenumber;
  }
  if (allowedScope.includes("@newscast/utils-app-ui")) {
    scope["@newscast/utils-app-ui"] = {
      Colors: {
        white: "#FFFFFF",
        black: "#000000",
        primary: "#F53071",
        secondary: "#FFF5F5",
        grey: "rgba(0,0,0,0.25)",
      },
    };
  }
  return scope;
}
