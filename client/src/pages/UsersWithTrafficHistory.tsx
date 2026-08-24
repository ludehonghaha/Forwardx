import { BarChart3 } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import UsersPage from "@/pages/Users";

/**
 * Keep the very large existing Users page untouched. A small floating admin
 * action exposes daily traffic history without increasing regression risk in
 * the user CRUD/package/reset surface.
 */
export default function UsersWithTrafficHistoryPage() {
  const [, navigate] = useLocation();
  return (
    <>
      <UsersPage />
      <Button
        className="fixed bottom-5 right-5 z-40 shadow-lg sm:bottom-6 sm:right-6"
        onClick={() => navigate("/user-traffic-history")}
      >
        <BarChart3 className="mr-1.5 h-4 w-4" />
        每日流量
      </Button>
    </>
  );
}
