import { Button } from "@/components/ui/button";
import { Network } from "lucide-react";
import { useLocation } from "wouter";

export default function DualMultipathLauncher() {
  const [, setLocation] = useLocation();
  return (
    <Button
      type="button"
      variant="secondary"
      className="fixed bottom-16 right-5 z-40 shadow-lg"
      onClick={() => setLocation("/dual-multipath")}
    >
      <Network className="mr-2 h-4 w-4" />
      Dual 聚合
    </Button>
  );
}
