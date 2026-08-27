import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Check, AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";
import { toast } from "sonner";

export default function Billing() {
  const [selectedPlan, setSelectedPlan] = useState<"pro-student" | "pro-professional">("pro-student");
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("monthly");

  const plans = {
    "pro-student": {
      name: "Pro (Student)",
      monthlyPrice: 4.99,
      annualPrice: 49.99,
      description: "Perfect for students who want to study smarter",
      features: [
        "Unlimited recording hours",
        "AI Socratic tutor mode",
        "Auto-generated flashcards",
        "Whiteboard photo integration",
        "Offline recording support",
        "Export to Quizlet & Anki",
        "Priority support"
      ]
    },
    "pro-professional": {
      name: "Pro (Professional)",
      monthlyPrice: 9.99,
      annualPrice: 99.99,
      description: "For professionals who want to automate their workflow",
      features: [
        "Unlimited recording hours",
        "Executive summaries",
        "Auto-assigned action items",
        "Email draft generation",
        "Slack & Calendar integration",
        "Team collaboration tools",
        "Advanced analytics",
        "Priority support"
      ]
    }
  };

  const currentPlan = plans[selectedPlan];
  const price = billingCycle === "monthly" ? currentPlan.monthlyPrice : currentPlan.annualPrice;
  const savings = billingCycle === "annual" ? Math.round((currentPlan.monthlyPrice * 12 - currentPlan.annualPrice) / (currentPlan.monthlyPrice * 12) * 100) : 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container h-16 flex items-center justify-between">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back to Home
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Upgrade to Pro</h1>
          <div className="w-20" />
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-12">
        <div className="max-w-5xl mx-auto space-y-12">
          {/* Header */}
          <div className="text-center space-y-4">
            <h1 className="text-4xl font-bold">Choose Your Plan</h1>
            <p className="text-lg text-muted-foreground">
              Upgrade to Pro and unlock all the features you need to succeed
            </p>
          </div>

          {/* Plan Selection */}
          <div className="grid md:grid-cols-2 gap-6">
            {Object.entries(plans).map(([key, plan]) => (
              <Card
                key={key}
                className={`p-6 border-2 cursor-pointer transition-all ${
                  selectedPlan === key
                    ? "border-accent bg-gradient-to-br from-accent/5 to-primary/5"
                    : "border-border hover:border-accent/50"
                }`}
                onClick={() => setSelectedPlan(key as "pro-student" | "pro-professional")}
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-xl font-bold">{plan.name}</h3>
                    <p className="text-sm text-muted-foreground">{plan.description}</p>
                  </div>
                  <div className="w-5 h-5 rounded-full border-2 border-accent flex items-center justify-center">
                    {selectedPlan === key && <div className="w-3 h-3 rounded-full bg-accent" />}
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Billing Cycle Toggle */}
          <div className="flex items-center justify-center gap-4">
            <span className={billingCycle === "monthly" ? "font-semibold" : "text-muted-foreground"}>
              Monthly
            </span>
            <button
              onClick={() => setBillingCycle(billingCycle === "monthly" ? "annual" : "monthly")}
              className="relative inline-flex h-8 w-14 items-center rounded-full bg-secondary"
            >
              <span
                className={`inline-block h-6 w-6 transform rounded-full bg-primary transition-transform ${
                  billingCycle === "annual" ? "translate-x-7" : "translate-x-1"
                }`}
              />
            </button>
            <span className={billingCycle === "annual" ? "font-semibold" : "text-muted-foreground"}>
              Annual
            </span>
            {billingCycle === "annual" && (
              <span className="ml-2 px-3 py-1 rounded-full bg-accent/20 text-accent text-sm font-semibold">
                Save {savings}%
              </span>
            )}
          </div>

          {/* Checkout Section */}
          <div className="grid lg:grid-cols-3 gap-8">
            {/* Left: Features */}
            <div className="lg:col-span-2 space-y-6">
              <Card className="p-8 border-2 border-border">
                <h2 className="text-2xl font-bold mb-6">What's Included</h2>
                <div className="space-y-4">
                  {currentPlan.features.map((feature, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <Check className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Billing Info */}
              <Card className="p-6 border-2 border-border bg-secondary/30">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold mb-1">Secure Payment</h3>
                    <p className="text-sm text-muted-foreground">
                      Your payment is processed securely. You can cancel anytime with no questions asked.
                    </p>
                  </div>
                </div>
              </Card>
            </div>

            {/* Right: Order Summary */}
            <div>
              <Card className="p-8 border-2 border-accent sticky top-24">
                <h3 className="text-xl font-bold mb-6">Order Summary</h3>

                <div className="space-y-4 mb-6 pb-6 border-b border-border">
                  <div>
                    <p className="text-muted-foreground text-sm mb-1">Plan</p>
                    <p className="font-semibold">{currentPlan.name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-sm mb-1">Billing Cycle</p>
                    <p className="font-semibold capitalize">
                      {billingCycle === "monthly" ? "Monthly" : "Annual"}
                    </p>
                  </div>
                </div>

                <div className="space-y-3 mb-6">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>${price.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tax</span>
                    <span>${(price * 0.1).toFixed(2)}</span>
                  </div>
                  <div className="border-t border-border pt-3 flex justify-between font-bold text-lg">
                    <span>Total</span>
                    <span>${(price * 1.1).toFixed(2)}</span>
                  </div>
                </div>

                <Button
                  size="lg"
                  className="w-full bg-accent hover:bg-accent/90 text-primary font-semibold mb-3"
                  onClick={() => {
                    toast.info("In-app subscription checkout is not available yet. Your plan has not been changed.");
                  }}
                >
                  Upgrade unavailable
                </Button>

                <Button variant="outline" size="sm" className="w-full">
                  Continue with Free Plan
                </Button>

                <p className="text-xs text-muted-foreground text-center mt-4">
                  By upgrading, you agree to our Terms of Service and Privacy Policy
                </p>
              </Card>
            </div>
          </div>

          {/* FAQ */}
          <div className="space-y-6">
            <h2 className="text-2xl font-bold">Billing Questions?</h2>
            <div className="grid md:grid-cols-2 gap-6">
              {[
                {
                  q: "Can I change my plan later?",
                  a: "Yes! You can upgrade, downgrade, or cancel your plan anytime from your account settings."
                },
                {
                  q: "What payment methods do you accept?",
                  a: "We accept all major credit cards, PayPal, and Apple Pay for your convenience."
                },
                {
                  q: "Do you offer refunds?",
                  a: "Yes. If you're not satisfied within 30 days, we'll refund your money, no questions asked."
                },
                {
                  q: "Is there a student discount?",
                  a: "Yes! Students get 50% off with a valid .edu email address. Contact support to apply."
                }
              ].map((faq, i) => (
                <Card key={i} className="p-6 border-2 border-border">
                  <h3 className="font-bold mb-2">{faq.q}</h3>
                  <p className="text-muted-foreground text-sm">{faq.a}</p>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
