import { useAuth } from "@/_core/hooks/useAuth";
import DualMultipathLauncher from "@/components/protocol/DualMultipathLauncher";
import NoBrandProviderLauncher from "@/components/protocol/NoBrandProviderLauncher";
import ProtocolAccessLegacyPage from "./ProtocolAccessLegacy";

export default function ProtocolAccessPage() {
  const { user } = useAuth();
  return (
    <>
      <ProtocolAccessLegacyPage />
      {user?.role === "admin" ? <DualMultipathLauncher /> : null}
      {user?.role === "admin" ? <NoBrandProviderLauncher /> : null}
    </>
  );
}
