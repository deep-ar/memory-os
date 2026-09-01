import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

export function registerStaticUi(app: FastifyInstance, root: string): void {
  app.register(fastifyStatic, {
    root,
    index: ["index.html"],
    cacheControl: true,
    maxAge: "1h",
    immutable: false,
  });
}
