import { createFileRoute } from "@tanstack/react-router";
import { Theater } from "@/components/theater";

export const Route = createFileRoute("/")({ component: Theater });
