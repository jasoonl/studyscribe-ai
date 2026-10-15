import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Lock, Loader2, Eye, EyeOff, AlertCircle, CheckCircle } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useI18n, t } from "@/i18n";

export default function ResetPassword() {
  const [, navigate] = useLocation();
  useI18n();
  const [token, setToken] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(true);
  const [isValidToken, setIsValidToken] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [formData, setFormData] = useState({
    password: "",
    confirmPassword: "",
  });
  const [resetSuccess, setResetSuccess] = useState(false);

  // Extract token from URL and validate it
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resetToken = params.get("token");

    if (!resetToken) {
      toast.error(t("password.noToken"));
      navigate("/login");
      return;
    }

    setToken(resetToken);

    // Validate token
    const validateToken = async () => {
      try {
        const response = await fetch(`/api/auth/validate-reset-token?token=${resetToken}`);
        if (response.ok) {
          setIsValidToken(true);
        } else {
          const error = await response.json();
          throw new Error(error.error || t("password.invalidToken"));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : t("password.checkFailed");
        toast.error(message);
        navigate("/login");
      } finally {
        setIsValidating(false);
      }
    };

    validateToken();
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (formData.password !== formData.confirmPassword) {
        throw new Error(t("signup.mismatch"));
      }

      if (formData.password.length < 8) {
        throw new Error(t("signup.tooShort"));
      }

      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          newPassword: formData.password,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || t("password.resetFailed"));
      }

      setResetSuccess(true);
      toast.success(t("password.resetDone"));
      setTimeout(() => navigate("/login"), 2000);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("password.resetFailed");
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  if (isValidating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md p-8 shadow-lg text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">{t("password.checking")}</p>
        </Card>
      </div>
    );
  }

  if (!isValidToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md p-8 shadow-lg">
          <div className="flex justify-center mb-4">
            <AlertCircle className="w-12 h-12 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-foreground text-center mb-2">{t("password.invalidTitle")}</h1>
          <p className="text-muted-foreground text-center mb-6">
            {t("password.invalidText")}
          </p>
          <Button onClick={() => navigate("/forgot-password")} className="w-full">
            {t("password.requestNew")}
          </Button>
        </Card>
      </div>
    );
  }

  if (resetSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md p-8 shadow-lg text-center">
          <div className="flex justify-center mb-4">
            <CheckCircle className="w-12 h-12 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">{t("password.doneTitle")}</h1>
          <p className="text-muted-foreground mb-6">
            {t("password.doneText")}
          </p>
          <Button onClick={() => navigate("/login")} className="w-full">
            {t("password.goToLogin")}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-8 shadow-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">{t("password.setTitle")}</h1>
          <p className="text-muted-foreground">{t("password.setSubtitle")}</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Password */}
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-foreground mb-2">
              {t("password.new")}
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 w-5 h-5 text-muted-foreground" />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
                className="pl-10 pr-10"
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? t("password.hide") : t("password.show")}
                className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{t("password.minLength")}</p>
          </div>

          {/* Confirm Password */}
          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-2">
              {t("password.confirm")}
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 w-5 h-5 text-muted-foreground" />
              <Input
                id="confirmPassword"
                type={showConfirm ? "text" : "password"}
                placeholder="••••••••"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                required
                className="pl-10 pr-10"
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                aria-label={showConfirm ? t("password.hide") : t("password.show")}
                className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
              >
                {showConfirm ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t("password.resetting")}
              </>
            ) : (
              t("password.reset")
            )}
          </Button>
        </form>

        {/* Back to Login */}
        <div className="mt-6 text-center">
          <button
            onClick={() => navigate("/login")}
            className="text-sm text-primary hover:underline"
          >
            ← {t("password.backToLogin")}
          </button>
        </div>
      </Card>
    </div>
  );
}
