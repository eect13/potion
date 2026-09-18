import { createFileRoute } from "@tanstack/react-router";
import { PotionApp } from "@/components/potion-app";

export const Route = createFileRoute("/")({ component: PotionApp });
