import { buildEmailDeps } from "../../_lib/email/deps";
import { handleUnsubscribe } from "../../_lib/email/handlers";
import { guarded, methodNotAllowed } from "../../_lib/http";

export const onRequestGet: PagesFunction<Env> = guarded(({ request, env }) => handleUnsubscribe(request, buildEmailDeps(env)));
export const onRequestPost: PagesFunction<Env> = guarded(({ request, env }) => handleUnsubscribe(request, buildEmailDeps(env)));
export const onRequest: PagesFunction<Env> = () => methodNotAllowed(["GET", "POST"]);
