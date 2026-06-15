import { act as reactAct } from "react";

/** React 19 exports act from 'react'; react-test-renderer drops it in production builds. */
export const act = reactAct;
