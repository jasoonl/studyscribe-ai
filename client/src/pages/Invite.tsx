import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Loader2, Ticket, CheckCircle, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export default function Invite() {
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isValid, setIsValid] = useState(false);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);

  const handleValidate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      toast.error("Please enter an invite code");
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/validate-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });

      const data = await response.json();

      if (!response.ok || !data.valid) {
        throw new Error(data.error || "Invalid invite code. Please check and try again.");
      }

      setIsValid(true);
      if (data.email) setInviteEmail(data.email);
      toast.success("Invite code verified! Redirecting to sign up...");

      // Redirect to signup with the validated code
      setTimeout(() => {
        window.location.href = `/signup?code=${encodeURIComponent(code.trim())}`;
      }, 1200);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid invite code";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-secondary/10 p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 mb-4">
            <Ticket className="w-8 h-8 text-accent" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">You're Invited</h1>
          <p className="text-muted-foreground">
            StudyScribe AI is currently invite-only. Enter your invite code below to create your account.
          </p>
        </div>

        <Card className="p-8 shadow-lg">
          {isValid ? (
            <div className="text-center py-4 space-y-3">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
              <p className="font-semibold text-foreground">Invite code verified!</p>
              {inviteEmail && (
                <p className="text-sm text-muted-foreground">
                  Signing you up as <span className="font-medium">{inviteEmail}</span>
                </p>
              )}
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Redirecting to sign up...</span>
              </div>
            </div>
          ) : (
            <form onSubmit={handleValidate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Invite Code
                </label>
                <Input
                  type="text"
                  placeholder="Enter your invite code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="font-mono tracking-widest text-center text-lg h-12"
                  autoFocus
                  disabled={isLoading}
                />
              </div>

              <Button
                type="submit"
                className="w-full h-11 font-medium"
                disabled={isLoading || !code.trim()}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Verifying...
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </form>
          )}
        </Card>

        {/* Already have account */}
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <a href="/login" className="text-accent font-medium hover:underline">
            Sign in
          </a>
        </p>

        {/* No invite? */}
        <p className="text-center text-sm text-muted-foreground">
          Don't have an invite code?{" "}
          <a
            href="mailto:hello@studyscribe.ai?subject=Invite Request"
            className="text-accent font-medium hover:underline"
          >
            Request access
          </a>
        </p>
      </div>
    </div>
  );
}
