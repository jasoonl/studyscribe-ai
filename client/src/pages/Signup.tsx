import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Mail, Lock, User, Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function Signup() {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const inviteCode = params.get("code") || "";

  const [formData, setFormData] = useState<{
    email: string;
    password: string;
    confirmPassword: string;
    name: string;
    inviteCode: string;
  }>({
    email: "",
    password: "",
    confirmPassword: "",
    name: "",
    inviteCode: inviteCode,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [inviteValid, setInviteValid] = useState<boolean | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Validate invite code on mount
  useEffect(() => {
    if (!inviteCode) return;

    const validateInvite = async () => {
      try {
        const response = await fetch("/api/auth/validate-invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: inviteCode }),
        });

        const data = await response.json();
        if (data.valid) {
          setInviteValid(true);
          setInviteError(null);
          if (data.email) {
            setFormData((prev) => ({ ...prev, email: data.email }));
          }
        } else {
          setInviteValid(false);
          setInviteError(data.error || "Invalid invite code");
        }
      } catch (error) {
        setInviteValid(false);
        setInviteError("Failed to validate invite code");
      }
    };

    validateInvite();
  }, [inviteCode]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    // Validation
    if (formData.password !== formData.confirmPassword) {
      toast.error("Passwords do not match");
      setIsLoading(false);
      return;
    }

    if (formData.password.length < 8) {
      toast.error("Password must be at least 8 characters");
      setIsLoading(false);
      return;
    }

    if (!formData.name.trim()) {
      toast.error("Name is required");
      setIsLoading(false);
      return;
    }

    if (!inviteCode) {
      toast.error("Invite code is required");
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          name: formData.name,
          inviteCode: formData.inviteCode,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Signup failed");
      }

      toast.success("Account created successfully!");
      navigate("/dashboard");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Signup failed";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-secondary/10 p-4">
      <Card className="w-full max-w-md p-8 shadow-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Join ScribeSync AI</h1>
          <p className="text-muted-foreground">Create your account to get started</p>
        </div>

        {/* Invite Code Status */}
        {inviteCode && (
          <div className="mb-6 p-3 rounded-lg border border-border bg-secondary/50">
            {inviteValid === true ? (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle className="w-4 h-4" />
                <span>Invite code verified</span>
              </div>
            ) : inviteValid === false ? (
              <div className="flex items-center gap-2 text-sm text-red-600">
                <AlertCircle className="w-4 h-4" />
                <span>{inviteError}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Validating invite code...</span>
              </div>
            )}
          </div>
        )}

        {/* Signup Form */}
        {inviteValid !== false && (
          <form onSubmit={handleSignup} className="space-y-4">
            {/* Name Input */}
            <div className="relative">
              <User className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Full name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="pl-10"
                required
                disabled={isLoading}
              />
            </div>

            {/* Email Input (Pre-filled from invite) */}
            <div className="relative">
              <Mail className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <Input
                type="email"
                placeholder="Email address"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="pl-10"
                required
                disabled={inviteValid === true || isLoading}
              />
            </div>

            {/* Password Input */}
            <div className="relative">
              <Lock className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Password (min 8 characters)"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="pl-10"
                required
                disabled={isLoading}
              />
            </div>

            {/* Confirm Password Input */}
            <div className="relative">
              <Lock className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Confirm password"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                className="pl-10"
                required
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-3 text-muted-foreground hover:text-foreground text-sm"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>

            {/* Signup Button */}
            <Button
              type="submit"
              className="w-full h-11 font-medium"
              disabled={isLoading || inviteValid !== true}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Creating account...
                </>
              ) : (
                "Create Account"
              )}
            </Button>
          </form>
        )}

        {/* Error State */}
        {inviteValid === false && (
          <div className="text-center py-8">
            <AlertCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
            <p className="text-muted-foreground mb-4">{inviteError}</p>
            <Button variant="outline" onClick={() => navigate("/")}>
              Back to Home
            </Button>
          </div>
        )}

        {/* Login Link */}
        <div className="text-center mt-6 pt-6 border-t border-border">
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <a href="/login" className="text-accent font-medium hover:underline">
              Sign in
            </a>
          </p>
        </div>
      </Card>
    </div>
  );
}
