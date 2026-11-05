import { redirect } from "next/navigation";
import { HOME } from "@/lib/auth/routes";

// The proxy sends signed-out visitors to /login; everyone else lands here.
export default function Home() {
  redirect(HOME);
}
