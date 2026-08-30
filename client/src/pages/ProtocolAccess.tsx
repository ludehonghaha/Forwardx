import { useAuth } from "@/_core/hooks/useAuth";
import NoBrandProviderLauncher from "@/components/protocol/NoBrandProviderLauncher";
import ProtocolAccessLegacyPage from "./ProtocolAccessLegacy";

export default function ProtocolAccessPage() {
  const { user } = useAuth();
  return (
    <>
      <ProtocolAccessLegacyPage />
      {user?.role === "admin" ? <NoBrandProviderLauncher /> : null}
    </>
  );
}
