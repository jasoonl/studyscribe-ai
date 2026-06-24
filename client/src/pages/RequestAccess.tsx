import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, BookOpen, ArrowLeft, Loader2 } from "lucide-react";

export default function RequestAccess() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const requestInvite = trpc.customAuth.requestInvite.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      setError("");
    },
    onError: (err) => {
      setError(err.message || "Something went wrong. Please try again.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim() || !email.trim()) return;
    requestInvite.mutate({ name: name.trim(), email: email.trim(), reason: reason.trim() || undefined });
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 py-12">
      {/* Logo */}
      <div className="mb-8 flex flex-col items-center gap-2">
        <img
          src="https://d2xsxph8kpxj0f.cloudfront.net/310519663693064768/ASvCfiALmBkqdhfm8YoYdn/studyscribe-logo-YqjarSv2s9a5LtpKjX9CE5.webp"
          alt="StudyScribe AI"
          className="w-12 h-12 rounded-xl shadow-sm"
        />
        <span className="text-xl font-bold text-gray-900">StudyScribe AI</span>
      </div>

      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        {submitted ? (
          /* Success state */
          <div className="flex flex-col items-center text-center gap-4 py-4">
            <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Request Received!</h1>
            <p className="text-gray-500 text-sm leading-relaxed">
              Thanks, <strong>{name}</strong>! We've received your request and will review it shortly.
              If approved, you'll receive an invite code at <strong>{email}</strong>.
            </p>
            <p className="text-gray-400 text-xs">
              Keep an eye on your inbox (and spam folder) — we typically respond within 24–48 hours.
            </p>
            <Link href="/login">
              <Button variant="outline" className="mt-2 gap-2">
                <ArrowLeft className="w-4 h-4" />
                Back to Sign In
              </Button>
            </Link>
          </div>
        ) : (
          /* Form state */
          <>
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-1">
                <BookOpen className="w-5 h-5 text-indigo-500" />
                <h1 className="text-2xl font-bold text-gray-900">Request Access</h1>
              </div>
              <p className="text-gray-500 text-sm">
                StudyScribe AI is currently invite-only. Fill in the form below and we'll send you an invite code when a spot opens up.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Jane Smith"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={requestInvite.isPending}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="jane@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={requestInvite.isPending}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reason">
                  Why do you want access?{" "}
                  <span className="text-gray-400 font-normal">(optional)</span>
                </Label>
                <Textarea
                  id="reason"
                  placeholder="I'm a college student who wants to turn my lecture recordings into study notes..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  disabled={requestInvite.isPending}
                  className="resize-none"
                />
                <span className="text-xs text-gray-400 text-right">{reason.length}/1000</span>
              </div>

              {error && (
                <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white mt-1"
                disabled={requestInvite.isPending || !name.trim() || !email.trim()}
              >
                {requestInvite.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  "Request Invite"
                )}
              </Button>
            </form>

            <div className="mt-6 pt-5 border-t border-gray-100 flex flex-col gap-2 text-center text-sm text-gray-500">
              <p>
                Already have an invite code?{" "}
                <Link href="/invite" className="text-indigo-600 hover:underline font-medium">
                  Enter it here
                </Link>
              </p>
              <p>
                Already have an account?{" "}
                <Link href="/login" className="text-indigo-600 hover:underline font-medium">
                  Sign in
                </Link>
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
