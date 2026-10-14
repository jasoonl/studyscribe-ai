type Group = { id: string; title: string; intro: string; items: Array<{ name: string; text: string }> };

const GROUPS: Group[] = [
  {
    id: "during",
    title: "While it is happening",
    intro: "Follow along live, without waiting for the recording to finish.",
    items: [
      { name: "Live transcript", text: "Words appear as they are spoken, with speaker labels when more than one person talks." },
      { name: "Study help", text: "Ask for a recap, an explanation or likely exam points from the last few minutes." },
      { name: "Captions", text: "A full-screen, high-contrast view in five text sizes." },
      { name: "Slides and tab audio", text: "Record a lecture tab or shared screen, with each new slide kept beside the transcript." },
      { name: "Meeting note-taker", text: "Send a note-taker to Zoom, Meet or Teams; it says it is recording." },
    ],
  },
  {
    id: "after",
    title: "When you study",
    intro: "Every recording is organised and searchable, so revision starts from what was said.",
    items: [
      { name: "Courses and tags", text: "File recordings by class, with a vocabulary of names and terms per course." },
      { name: "Ask across recordings", text: "Questions are answered from your lectures, with links to the exact moment." },
      { name: "Tasks and deadlines", text: "Homework, readings and exam dates pulled out of what the lecturer said." },
      { name: "Chapters and key terms", text: "Jump through a long lecture by topic." },
      { name: "Exam packs", text: "One guide and a practice exam from a whole course." },
      { name: "Note templates", text: "Cornell notes, revision sheets, lab notes, meeting minutes and more." },
    ],
  },
  {
    id: "together",
    title: "With other people",
    intro: "Share what you recorded, and decide how much others can change.",
    items: [
      { name: "Sharing with roles", text: "View, comment or edit, for one person or a study group." },
      { name: "Comments", text: "Highlight a line, start a thread and mention a classmate." },
      { name: "Teams", text: "A shared course library, seats on one bill, a verified domain and single sign-on." },
    ],
  },
  {
    id: "everywhere",
    title: "Wherever you work",
    intro: "Record where the lecture or meeting is, and send the results where you keep things.",
    items: [
      { name: "Apps", text: "Chrome extension, desktop app for system audio, and a phone app." },
      { name: "Connected tools", text: "Send notes to Notion or Google Docs and read your calendar to name recordings." },
      { name: "API and webhooks", text: "Personal API keys, and updates to your own server, Slack or Discord." },
    ],
  },
];

/** The features added since launch, as plain grouped lists (no icon grid). */
export default function MoreFeatures() {
  return (
    <section id="more-features" aria-labelledby="more-features-heading" className="scroll-mt-24 border-t border-border/60 py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <h2 id="more-features-heading" className="text-balance text-4xl font-bold tracking-[-0.035em] sm:text-5xl">More than a transcript</h2>
          <p className="mt-4 text-lg text-muted-foreground">What StudyScribe does during a class or meeting, and after it.</p>
        </div>
        <div className="mt-16 grid gap-x-12 gap-y-14 md:grid-cols-2">
          {GROUPS.map(group => (
            <div key={group.id}>
              <h3 className="text-xl font-semibold tracking-[-0.02em]">{group.title}</h3>
              <p className="mt-2 text-muted-foreground">{group.intro}</p>
              <dl className="mt-6 divide-y divide-border/70 border-y border-border/70">
                {group.items.map(item => (
                  <div key={item.name} className="grid gap-1 py-4 sm:grid-cols-[11rem_1fr] sm:gap-6">
                    <dt className="font-medium">{item.name}</dt>
                    <dd className="text-muted-foreground">{item.text}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
