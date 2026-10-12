// Seeds the demo library used for the landing screenshots and the demo video frames:
// fourteen lectures and meetings across subjects (one transcribed in Spanish), with
// notes, flashcards and review history, quizzes, a study guide, an email draft and a
// tutor chat. Narration lines in storyboard.json refer to some of this content
// ("What does AI stand for?", the 40-second reading, the 7-minute class), so keep the
// two in step.
//
//   DATABASE_URL=mysql://user:pass@127.0.0.1:3306/db node seed-library.mjs
//
// It deletes and rewrites the demo user's data, so it refuses any non-local database.
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

const url = new URL(process.env.DATABASE_URL || "");
if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
  console.error("Refusing to seed a non-local database. Point DATABASE_URL at a local copy.");
  process.exit(1);
}
const EMAIL = process.env.DEMO_USER_EMAIL || "demo@example.com";
const PASSWORD = process.env.DEMO_USER_PASSWORD || "demo-password-1";
const db = await mysql.createConnection({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1) });
let [[user]] = await db.query("SELECT id FROM users WHERE email=?", [EMAIL]);
if (!user) {
  const [created] = await db.query("INSERT INTO users (`email`,`passwordHash`,`name`,`loginMethod`,`role`,`emailVerified`,`termsAcceptedAt`) VALUES (?,?,?,?,?,1,NOW())", [EMAIL, await bcrypt.hash(PASSWORD, 10), "Alex Rivera", "email", "user"]);
  user = { id: created.insertId };
}
const userId = user.id;
await db.query("UPDATE users SET name='Alex Rivera' WHERE id=?", [userId]);
for (const table of ["recordingBookmarks", "chatHistory", "emailDrafts", "quizzes", "studyGuides", "flashcards", "flashcardReviews", "studyNotes", "transcripts", "recordings"]) {
  await db.query(`DELETE FROM \`${table}\` WHERE userId=?`, [userId]);
}

const daysAgo = n => new Date(Date.now() - n * 86400000);

function segmentsFrom(lines) {
  let t = 0;
  return lines.map(([speaker, text], i) => {
    const length = Math.max(4, Math.round(text.split(" ").length / 2.6));
    const seg = { id: String(i + 1), start: t, end: t + length, text, speaker };
    t += length + 1;
    return seg;
  });
}

async function addRecording({ title, audience = "student", minutes, seconds, ago, lines, speakers = {}, language = "en" }) {
  const [r] = await db.query(
    "INSERT INTO recordings (`userId`,`title`,`audioUrl`,`audioKey`,`duration`,`audience`,`status`,`createdAt`) VALUES (?,?,?,?,?,?,?,?)",
    [userId, title, "/qa-audio.mp3", `qa/${title}.bin`, seconds ?? minutes * 60, audience, "completed", daysAgo(ago)],
  );
  const named = lines.map(([s, text]) => [speakers[s] ?? s, text]);
  const segments = segmentsFrom(named);
  await db.query("INSERT INTO `transcripts` (`recordingId`,`userId`,`fullText`,`segments`,`language`,`status`) VALUES (?,?,?,?,?,?)", [
    r.insertId, userId, named.map(l => l[1]).join(" "), JSON.stringify(segments), language, "completed",
  ]);
  return r.insertId;
}

const ids = {};

ids.bio = await addRecording({
  title: "Cell Biology: Mitochondria and ATP", minutes: 52, ago: 1, speakers: { A: "Dr. Okafor", B: "Student" },
  lines: [
    ["A", "Today we follow a glucose molecule all the way to ATP, the cell's energy currency."],
    ["A", "Glycolysis happens in the cytoplasm and nets two ATP per glucose."],
    ["A", "Pyruvate then moves into the mitochondrion, where the Krebs cycle runs in the matrix."],
    ["B", "Why does the cell bother with the mitochondria if glycolysis already makes ATP?"],
    ["A", "Because the electron transport chain yields roughly thirty more ATP. Glycolysis alone is a trickle."],
    ["A", "The inner membrane is folded into cristae, which gives the chain more surface area."],
    ["A", "Protons are pumped into the intermembrane space, and ATP synthase lets them flow back."],
    ["A", "That flow turns the synthase like a turbine. This is chemiosmosis."],
    ["A", "Oxygen is the final electron acceptor. Without it the chain backs up and stops."],
  ],
});
ids.econ = await addRecording({
  title: "Intro to Microeconomics: Supply and Demand", minutes: 48, ago: 2, speakers: { A: "Prof. Haddad", B: "Student" },
  lines: [
    ["A", "A demand curve slopes down: as the price falls, people buy more."],
    ["A", "Supply slopes up, because higher prices make it worth producing more."],
    ["A", "Where the two cross is the equilibrium price and quantity."],
    ["B", "What happens if the government sets a price ceiling below that point?"],
    ["A", "You get a shortage. Quantity demanded exceeds quantity supplied, so queues form."],
    ["A", "Elasticity tells us how strongly quantity responds to a price change."],
    ["A", "Insulin is inelastic. Concert tickets for a band you only half like are elastic."],
  ],
});
ids.history = await addRecording({
  title: "World History: Causes of World War I", minutes: 55, ago: 3, speakers: { A: "Prof. Lindqvist" },
  lines: [
    ["A", "Historians often use the acronym MAIN: militarism, alliances, imperialism and nationalism."],
    ["A", "By 1914 Europe was split into the Triple Entente and the Triple Alliance."],
    ["A", "On 28 June 1914 Archduke Franz Ferdinand was assassinated in Sarajevo."],
    ["A", "Austria-Hungary issued an ultimatum to Serbia, and the alliance system pulled everyone in."],
    ["A", "Germany's Schlieffen Plan assumed a quick war in the west before Russia could mobilise."],
  ],
});
ids.orgo = await addRecording({
  title: "Organic Chemistry: SN1 vs SN2 Reactions", minutes: 61, ago: 4, speakers: { A: "Dr. Mehta" },
  lines: [
    ["A", "SN2 is one concerted step: the nucleophile attacks as the leaving group leaves."],
    ["A", "That backside attack inverts the stereocentre, the Walden inversion."],
    ["A", "SN1 goes through a carbocation, so tertiary substrates favour it."],
    ["A", "Polar protic solvents stabilise the carbocation and speed up SN1."],
    ["A", "Because the carbocation is planar, SN1 gives a racemic mixture."],
  ],
});
ids.psych = await addRecording({
  title: "Intro to Psychology: Classical Conditioning", minutes: 44, ago: 5, speakers: { A: "Prof. Nakamura" },
  lines: [
    ["A", "Pavlov noticed his dogs salivated before the food arrived, at the sound of footsteps."],
    ["A", "Food is the unconditioned stimulus. Salivating to food is the unconditioned response."],
    ["A", "Pair a bell with food often enough and the bell alone triggers salivation."],
    ["A", "If the bell keeps ringing without food, the response fades. That is extinction."],
    ["A", "After a rest the response can return briefly, which we call spontaneous recovery."],
  ],
});
ids.calc = await addRecording({
  title: "Calculus II: Integration by Parts", minutes: 50, ago: 6, speakers: { A: "Prof. Alvarez" },
  lines: [
    ["A", "Integration by parts comes from the product rule: the integral of u dv equals uv minus the integral of v du."],
    ["A", "Pick u with LIATE: logs, inverse trig, algebraic, trig, exponential."],
    ["A", "For x times e to the x, let u be x and dv be e to the x dx."],
  ],
});
ids.roadmap = await addRecording({
  title: "Q3 Product Roadmap Sync", audience: "professional", minutes: 37, ago: 2, speakers: { A: "Priya (PM)", B: "Marcus (Eng)", C: "Dana (Design)" },
  lines: [
    ["A", "Goal for today: lock the Q3 scope and owners."],
    ["B", "Offline mode is three sprints, not two. Sync conflicts are the hard part."],
    ["C", "I can have the onboarding redesign ready for review by the twelfth."],
    ["A", "Then offline mode moves to Q4 and onboarding ships first. Marcus, can you write the sync spec?"],
    ["B", "Yes, by next Friday."],
  ],
});
ids.spanish = await addRecording({
  title: "Spanish 201: Preterite vs Imperfect", seconds: 7 * 60, ago: 0.08, language: "es", speakers: { A: "Profa. Ruiz", B: "Estudiante" },
  lines: [
    ["A", "Buenos días. Hoy comparamos el pretérito y el imperfecto."],
    ["A", "Usamos el pretérito para acciones terminadas: ayer comí paella con mi familia."],
    ["A", "El imperfecto describe el fondo y los hábitos: cuando era niña, comía paella los domingos."],
    ["B", "¿Y si una acción interrumpe a otra?"],
    ["A", "Muy buena pregunta. La acción de fondo va en imperfecto y la interrupción en pretérito."],
    ["A", "Por ejemplo: leía un libro cuando sonó el teléfono."],
    ["A", "Para el examen, practiquen con los verbos irregulares: fui, hice, tuve y estuve."],
  ],
});
ids.ds = await addRecording({
  title: "Data Structures: Hash Tables", minutes: 58, ago: 8, speakers: { A: "Dr. Kowalski" },
  lines: [
    ["A", "A hash function maps a key to a bucket index in constant time on average."],
    ["A", "Collisions are handled by chaining or by open addressing."],
    ["A", "Keep the load factor under about 0.75 and resize by doubling."],
  ],
});
ids.marketing = await addRecording({
  title: "Marketing Team Weekly", audience: "professional", minutes: 29, ago: 9, speakers: { A: "Sam", B: "Lena" },
  lines: [
    ["A", "The back-to-school campaign beat last year's sign-ups."],
    ["B", "The email subject line test is done; the shorter one won."],
  ],
});
ids.art = await addRecording({
  title: "Art History: Impressionism", minutes: 46, ago: 10, speakers: { A: "Dr. Moreau" },
  lines: [
    ["A", "Monet's Impression, Sunrise gave the movement its name, at first as an insult."],
    ["A", "Painting outdoors, en plein air, let artists catch light as it changed."],
  ],
});
ids.poem = await addRecording({
  title: "Poetry Reading: The Road Not Taken", seconds: 40, ago: 0.04, speakers: { A: "Reader" },
  lines: [
    ["A", "The Road Not Taken, by Robert Frost."],
    ["A", "Two roads diverged in a yellow wood, and sorry I could not travel both and be one traveler, long I stood."],
    ["A", "I took the one less traveled by, and that has made all the difference."],
  ],
});
ids.ai = await addRecording({
  title: "Intro to Artificial Intelligence", seconds: 73, ago: 0.12, speakers: { A: "Dr. Patel" },
  lines: [
    ["A", "AI is one of the most transformative technologies of our time."],
    ["A", "It lets computers learn from data, spot patterns, and make decisions."],
    ["A", "You already use it: virtual assistants, recommendations, and fraud detection."],
    ["A", "In healthcare it helps doctors read scans and catch disease earlier."],
  ],
});
ids.thermo = await addRecording({
  title: "Thermodynamics, lecture 4", minutes: 3, ago: 11, speakers: { A: "Prof. Lee", B: "Student" },
  lines: [
    ["A", "Good morning. Today we cover entropy and the second law of thermodynamics."],
    ["A", "Entropy measures how many microscopic arrangements match what we observe."],
    ["A", "In an isolated system, entropy never decreases. That is the second law."],
    ["B", "Does that mean a fridge breaks the second law, since it makes things colder?"],
    ["A", "Good question. The fridge is not isolated: it dumps more entropy into the kitchen than it removes."],
    ["A", "So total entropy still goes up. Remember this for the exam, it comes up every year."],
    ["B", "Is entropy the same thing as disorder?"],
    ["A", "Disorder is a loose picture. The precise idea is the count of microstates, written S equals k log W."],
    ["A", "Boltzmann's constant k links the microscopic count to the units we measure in the lab."],
    ["A", "Next week we look at heat engines and the Carnot efficiency."],
  ],
});

// Study notes: microeconomics (lecture template)
await db.query("INSERT INTO studyNotes (`recordingId`,`userId`,`type`,`content`,`metadata`) VALUES (?,?,?,?,?)", [
  ids.econ, userId, "key_concepts",
  `## Key Concepts
- **Law of demand:** as price falls, quantity demanded rises, so the demand curve slopes down.
- **Law of supply:** higher prices make production worthwhile, so the supply curve slopes up.
- **Equilibrium:** the price where quantity supplied equals quantity demanded.
- **Price ceiling:** a legal maximum below equilibrium creates a *shortage* (queues, rationing).

## Formulas and Definitions
- Price elasticity of demand = % change in quantity demanded ÷ % change in price
- |E| > 1 is elastic, |E| < 1 is inelastic

## Examples Used
- Insulin: inelastic, people buy it whatever the price.
- Concert tickets for a band you half like: elastic.

## What to Review Next
- Practice shifting curves vs. moving along them.
- Chapter 4, consumer and producer surplus.`,
  JSON.stringify({ template: "lecture" }),
]);

// Flashcards: cell biology
const cards = [
  ["Where does glycolysis take place?", "In the cytoplasm.", "easy"],
  ["How much ATP does glycolysis net per glucose?", "Two ATP.", "easy"],
  ["Where does the Krebs cycle run?", "In the mitochondrial matrix.", "medium"],
  ["Why is the inner membrane folded into cristae?", "To increase surface area for the electron transport chain.", "medium"],
  ["What is chemiosmosis?", "Protons flow back through ATP synthase, turning it like a turbine to make ATP.", "hard"],
  ["What is the final electron acceptor in the chain?", "Oxygen.", "medium"],
  ["Roughly how much extra ATP does the electron transport chain yield?", "About thirty ATP per glucose.", "hard"],
];
// Review history: two cards being learned (Learn mode asks for written recall on these),
// two mastered, the rest new, so the deck shows real progress.
for (const [i, [question, answer, difficulty]] of cards.entries()) {
  const [card] = await db.query("INSERT INTO flashcards (`recordingId`,`userId`,`question`,`answer`,`difficulty`) VALUES (?,?,?,?,?)", [ids.bio, userId, question, answer, difficulty]);
  const status = i < 2 ? "learning" : i < 4 ? "mastered" : null;
  if (status) {
    await db.query("INSERT INTO flashcardReviews (`userId`,`flashcardId`,`recordingId`,`status`,`reviewCount`,`lastReviewedAt`,`masteredAt`) VALUES (?,?,?,?,?,NOW(),?)", [userId, card.insertId, ids.bio, status, 1, status === "mastered" ? new Date() : null]);
  }
}
for (const [question, answer, difficulty] of [
  ["What does AI stand for?", "Artificial intelligence", "easy"],
  ["What are three capabilities AI enables computers to do?", "Learn from data, recognize patterns, and make decisions.", "medium"],
  ["Name two everyday uses of AI from the lecture.", "Virtual assistants and recommendations.", "easy"],
  ["How does AI help in healthcare?", "It helps doctors read scans and catch disease earlier.", "medium"],
]) {
  await db.query("INSERT INTO flashcards (`recordingId`,`userId`,`question`,`answer`,`difficulty`) VALUES (?,?,?,?,?)", [ids.ai, userId, question, answer, difficulty]);
}
const aiQuiz = [
  { q: "What is AI described as in the transcript?", o: ["A futuristic concept that is yet to be developed.", "A simple computer program for basic tasks.", "One of the most transformative technologies of our time.", "A technology primarily used for entertainment."], a: 2, e: "The lecture opens by calling AI one of the most transformative technologies of our time." },
  { q: "Which is NOT listed as something AI lets computers do?", o: ["Learn from data", "Spot patterns", "Make decisions", "Replace electricity"], a: 3, e: "The lecture lists learning, spotting patterns and making decisions." },
];
await db.query("INSERT INTO quizzes (`recordingId`,`userId`,`title`,`description`,`questions`,`status`,`generatedAt`) VALUES (?,?,?,?,?,?,NOW())", [
  ids.ai, userId, "Intro to AI", "Check what you remember from the lecture.",
  JSON.stringify(aiQuiz.map((item, i) => ({ id: `q${i + 1}`, question: item.q, type: "multiple-choice", options: item.o, correctAnswer: item.o[item.a], explanation: item.e }))),
  "completed",
]);
// Same deck idea for psychology so the library has more than one deck.
for (const [question, answer] of [["What is extinction?", "The conditioned response fades when the stimulus keeps appearing without the reward."], ["What is spontaneous recovery?", "An extinguished response briefly returns after a rest."]]) {
  await db.query("INSERT INTO flashcards (`recordingId`,`userId`,`question`,`answer`,`difficulty`) VALUES (?,?,?,?,?)", [ids.psych, userId, question, answer, "medium"]);
}

// Quiz: World War I
const quiz = [
  { q: "What does the acronym MAIN stand for?", o: ["Militarism, alliances, imperialism, nationalism", "Monarchy, armies, industry, navies", "Mobilisation, alliances, invasion, neutrality", "Markets, alliances, imperialism, nations"], a: 0, e: "The lecture used MAIN as a memory aid for the long-term causes." },
  { q: "Where was Archduke Franz Ferdinand assassinated?", o: ["Vienna", "Sarajevo", "Belgrade", "Berlin"], a: 1, e: "He was shot in Sarajevo on 28 June 1914." },
  { q: "Which countries formed the Triple Entente?", o: ["Germany, Austria-Hungary, Italy", "Britain, France, Russia", "Britain, Germany, Russia", "France, Italy, Serbia"], a: 1, e: "Britain, France and Russia faced the Triple Alliance." },
  { q: "What did the Schlieffen Plan assume?", o: ["A long war of attrition", "A quick victory in the west before Russia mobilised", "Neutrality from Britain", "An invasion from Italy"], a: 1, e: "Germany planned to defeat France quickly, then turn east." },
  { q: "Who issued the ultimatum to Serbia?", o: ["Germany", "Russia", "Austria-Hungary", "Ottoman Empire"], a: 2, e: "Austria-Hungary's ultimatum set the alliance system in motion." },
  { q: "Which alliance included Germany?", o: ["Triple Entente", "Triple Alliance", "Holy Alliance", "League of Nations"], a: 1, e: "Germany, Austria-Hungary and Italy formed the Triple Alliance." },
  { q: "In what year did the war begin?", o: ["1912", "1914", "1916", "1918"], a: 1, e: "Fighting began in the summer of 1914." },
  { q: "What does 'militarism' refer to in MAIN?", o: ["Building up armies and navies", "Colonial expansion", "Pride in one's nation", "Secret treaties"], a: 0, e: "Militarism is the arms build-up and the influence of military planning." },
  { q: "Which empire was Franz Ferdinand heir to?", o: ["German", "Russian", "Austro-Hungarian", "Ottoman"], a: 2, e: "He was heir to the Austro-Hungarian throne." },
  { q: "Why did the alliance system widen the war?", o: ["It forced members to defend each other", "It banned mobilisation", "It froze trade", "It ended colonial rivalry"], a: 0, e: "Each alliance obliged its members to join in, so a local crisis spread." },
];
await db.query("INSERT INTO quizzes (`recordingId`,`userId`,`title`,`description`,`questions`,`status`,`generatedAt`) VALUES (?,?,?,?,?,?,NOW())", [
  ids.history, userId, "Causes of World War I", "Ten questions on the long-term and immediate causes.",
  JSON.stringify(quiz.map((item, i) => ({ id: `q${i + 1}`, question: item.q, type: "multiple-choice", options: item.o, correctAnswer: item.o[item.a], explanation: item.e }))),
  "completed",
]);

// Study guide: organic chemistry
await db.query("INSERT INTO studyGuides (`recordingId`,`userId`,`title`,`content`,`keyPoints`,`status`,`generatedAt`) VALUES (?,?,?,?,?,?,NOW())", [
  ids.orgo, userId, "Study Guide: SN1 vs SN2",
  `## Overview
Two ways a nucleophile replaces a leaving group. SN2 happens in one step; SN1 goes through a carbocation.

## Key Concepts
| | SN2 | SN1 |
|---|---|---|
| Steps | One, concerted | Two, carbocation first |
| Best substrate | Methyl, primary | Tertiary |
| Solvent | Polar aprotic | Polar protic |
| Stereochemistry | Inversion (Walden) | Racemic mixture |

## Important Details
- Backside attack is why SN2 inverts the stereocentre.
- A planar carbocation can be attacked from either face, so SN1 racemises.

## Review Questions
1. Why does a tertiary substrate rarely react by SN2?
2. Which solvent would you choose to speed up an SN1 reaction, and why?`,
  JSON.stringify(["SN2 is one concerted step with inversion", "SN1 forms a carbocation and racemises", "Tertiary favours SN1, primary favours SN2"]),
  "completed",
]);

// Email draft: product roadmap meeting
await db.query("INSERT INTO emailDrafts (`recordingId`,`userId`,`title`,`subject`,`content`,`draftType`,`tone`,`status`,`generatedAt`) VALUES (?,?,?,?,?,?,?,?,NOW())", [
  ids.roadmap, userId, "Email Summary: Q3 Product Roadmap Sync", "Q3 roadmap: onboarding first, offline mode moves to Q4",
  `Hi all,

Here is a summary of today's Q3 roadmap sync.

**Decisions**
- The onboarding redesign ships first in Q3.
- Offline mode moves to Q4. Sync conflicts need three sprints, not two.

**Action items**
- Dana: onboarding redesign ready for review by the 12th.
- Marcus: written spec for offline sync by next Friday.

Let me know if I missed anything.

Priya`,
  "email-summary", "formal", "completed",
]);

// Tutor chat: psychology
const chat = [
  ["user", "Explain the difference between the unconditioned and conditioned stimulus."],
  ["assistant", "In the lecture's example, food is the unconditioned stimulus: the dogs salivate to it without any learning. The bell starts out neutral. After it has been paired with food many times, it becomes the conditioned stimulus, because it now triggers salivation on its own."],
  ["user", "So what would extinction look like with the bell?"],
  ["assistant", "Keep ringing the bell without ever bringing food. Each time, the salivation gets weaker until it mostly stops. Professor Nakamura also mentioned that after a rest it can briefly come back, which is spontaneous recovery. Can you think of an everyday habit that fades the same way?"],
];
for (const [role, content] of chat) {
  await db.query("INSERT INTO chatHistory (`recordingId`,`userId`,`role`,`content`) VALUES (?,?,?,?)", [ids.psych, userId, role, content]);
}

await db.query("INSERT INTO recordingBookmarks (`recordingId`,`userId`,`atSeconds`) VALUES (?,?,?),(?,?,?)", [ids.thermo, userId, 46, ids.thermo, userId, 90]);
console.log(JSON.stringify(ids));
await db.end();
