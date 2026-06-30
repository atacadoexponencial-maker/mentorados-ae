"use client";

import { AuthGate } from "@/components/auth-gate";
import { MentoriaApp } from "@/components/mentoria-app";

export default function Home() {
  return <AuthGate>{({ email, signOut }) => <MentoriaApp userEmail={email} onSignOut={signOut} />}</AuthGate>;
}
