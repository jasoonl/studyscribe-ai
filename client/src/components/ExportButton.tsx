import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExportButtonProps {
  content: string;
  filename: string;
  format?: "markdown" | "pdf";
}

export function ExportButton({ content, filename, format = "markdown" }: ExportButtonProps) {
  const handleExport = () => {
    try {
      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      alert(`File exported as ${filename}`);
    } catch (error) {
      alert("Failed to export file");
    }
  };

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleExport}
      className="gap-2"
    >
      <Download className="w-4 h-4" />
      Export as {format === "markdown" ? "Markdown" : "PDF"}
    </Button>
  );
}
