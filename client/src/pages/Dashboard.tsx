import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Loader2, Plus, Mic, Upload, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

export default function Dashboard() {
  const { user, logout } = useAuth();
  const { data: recordings, isLoading } = trpc.recordings.list.useQuery();
  const [showUploadModal, setShowUploadModal] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="https://d2xsxph8kpxj0f.cloudfront.net/310519663693064768/ASvCfiALmBkqdhfm8YoYdn/scribesyncs-logo-myaZdb94CzsaGY5RkidZFa.webp"
              alt="ScribeSync AI"
              className="w-8 h-8"
            />
            <span className="text-lg font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              ScribeSync AI
            </span>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              Welcome, {user?.name || user?.email}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => logout()}
            >
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-12">
        {/* Section: New Recording */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold mb-6">Your Recordings</h1>
          
          <div className="grid md:grid-cols-2 gap-6 mb-12">
            {/* Record New */}
            <Card className="p-8 border-2 border-dashed border-accent hover:border-accent/80 transition-colors cursor-pointer group">
              <Link href="/record">
                <div className="flex flex-col items-center justify-center gap-4 text-center">
                  <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Mic className="w-8 h-8 text-accent" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">Record New</h3>
                    <p className="text-sm text-muted-foreground">
                      Start recording a lecture or meeting
                    </p>
                  </div>
                </div>
              </Link>
            </Card>

            {/* Upload File */}
            <Card className="p-8 border-2 border-dashed border-primary hover:border-primary/80 transition-colors cursor-pointer group">
              <div className="flex flex-col items-center justify-center gap-4 text-center" onClick={() => setShowUploadModal(true)}>
                <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Upload className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">Upload File</h3>
                  <p className="text-sm text-muted-foreground">
                    Upload an existing audio file
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* Recordings List */}
        <div>
          <h2 className="text-2xl font-bold mb-6">
            {recordings && recordings.length > 0
              ? `${recordings.length} Recording${recordings.length !== 1 ? "s" : ""}`
              : "No Recordings Yet"}
          </h2>

          {recordings && recordings.length > 0 ? (
            <div className="grid gap-4">
              {recordings.map((recording) => (
                <Link key={recording.id} href={`/recording/${recording.id}`}>
                  <Card className="p-6 border-2 border-border hover:border-accent/50 transition-colors cursor-pointer group">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="text-lg font-bold group-hover:text-accent transition-colors">
                          {recording.title}
                        </h3>
                        {recording.description && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {recording.description}
                          </p>
                        )}
                        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                          <span>
                            {recording.duration
                              ? `${Math.round(recording.duration / 60)} min`
                              : "Duration pending"}
                          </span>
                          <span className="capitalize">
                            {recording.audience === "student" ? "Student" : "Professional"}
                          </span>
                          <span className="capitalize px-2 py-1 rounded-full bg-secondary">
                            {recording.status}
                          </span>
                          <span>
                            {new Date(recording.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.preventDefault();
                          // TODO: Implement delete
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <Card className="p-12 border-2 border-border text-center">
              <div className="space-y-4">
                <Mic className="w-12 h-12 text-muted-foreground mx-auto opacity-50" />
                <div>
                  <h3 className="text-lg font-bold">No recordings yet</h3>
                  <p className="text-muted-foreground">
                    Start by recording a lecture or uploading an audio file to get started.
                  </p>
                </div>
                <div className="flex gap-3 justify-center pt-4">
                  <Link href="/record">
                    <Button className="bg-accent hover:bg-accent/90 text-primary">
                      <Mic className="w-4 h-4 mr-2" />
                      Record Now
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
