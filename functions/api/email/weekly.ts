import { buildEmailDeps } from "../../_lib/email/deps";
import { handleWeekly } from "../../_lib/email/handlers";
import { methodNotAllowed } from "../../_lib/http";

export const onRequestPost: PagesFunction<Env> = ({ request, env }) => handleWeekly(request, buildEmailDeps(env));
export const onRequest: PagesFunction<Env> = () => methodNotAllowed(["POST"]);
