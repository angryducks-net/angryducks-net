<p align="center"><img src="logo/angryducks-head-icon.svg" width="96" alt="AngryDucks duck head logo"></p>

# AngryDucks

The community forum for builders who ship with AI, and the open source code behind it.

- **Live forum:** [community.angryducks.net](https://community.angryducks.net) (invite-only for now)
- **Code:** [`forum/`](forum/), a Cloudflare Worker with a D1 database. See [forum/README.md](forum/README.md) to run it locally.
- **Design decisions:** [docs/community-decisions.md](docs/community-decisions.md), the running log of why the community and forum work the way they do.
- **Current spec:** [docs/forum-mvp0-spec.md](docs/forum-mvp0-spec.md)

---

<!-- MANIFESTO:START: generated from MANIFESTO.md by forum/scripts/sync-manifesto.mjs, edit that file instead -->
## ANGRY DUCKS MANIFESTO
> **"No more quacking. Just launching."**

Welcome to **Angry Ducks**.

We are an independent community of builders, creators, and decision-makers challenging the slow, bureaucratic, and bloated systems of traditional software engineering.

---

#### Why "Angry"?
We are done with endless alignment meetings, bureaucratic sign-offs, slideware architects, and platform algorithms dictating our information and products.

Our anger is not noise or destructive rage. **Anger is fuel.** It is zero-tolerance for inefficiency, and the driving force that pushes a builder through every obstacle until an idea is shipped to real users.

#### Why "Ducks"?
* **Paddling like mad underneath:** Like a duck gliding calmly while working fiercely below the waterline, modern builders quietly leverage AI agents, automation pipelines, and modern toolchains.
* **The Rubber Duck is awake:** Rubber Duck Debugging forced us to explain our thinking line by line. But this duck is no longer just a passive listener—it questions: *"Why this architecture? Where will this break in production?"*
* **No Quackers:** "Quack" represents hollow buzzwords, endless debates, and fake expertise. We cut the noise and focus on shipping.

#### Build with Fire, Evaluate with Standards
AI makes generating prototypes trivial, but building lasting products remains challenging. Anyone can spin up code that breaks in production or collects technical debt.

Angry Ducks pairs **fire** with **craftsmanship**:
* We respect battle-tested fundamentals: usability, information hierarchy, security baselines, and scalable architecture.
* AI handles the mechanical implementation; **you remain the Decision Maker**.
* We don’t just write prompts—we train our judgment to critically evaluate AI output.

> **Build with fire. Evaluate with standards.**

---

### The Four Ground Rules

#### 1. No Quacking (Deliver, Don’t Talk)
Ideas are cheap. Execution is gold. We do not care about high-level conceptual pitches. Don't write essays about what you "plan to build"—build the prototype and drop the live link.

#### 2. Break the Chains (Be an Army of One)
Outdated playbooks are designed for bureaucratic paralysis. We are super-individuals. Use AI agents, automation, and model orchestration to bypass red tape and break through walls at maximum speed.

#### 3. Just Launching (Ship Early)
Perfect plans gather dust in drawers; rough, battle-tested demos live in browsers. Even if it's raw, ship early, collide with real-world feedback, and iterate fast.

#### 4. Respect the Craft (Own Your Decisions)
Speed does not mean blind gambling. When you ship, be transparent about what works and where the known issues lie. If you cannot explain or evaluate what you deploy, you are not innovating—you are guessing.

---

**Stop quacking. Start building. Let's launch.**
<!-- MANIFESTO:END -->

---

## Contributing

This forum is a public asset, built by its community. **Every idea and every pull request is welcome, and AI-coded pull requests are especially welcome.** Use whatever agents and tools you like; what we ask for is judgment, in the spirit of rule 4.

1. **Small ideas:** open a pull request. **Bigger changes:** open an issue first so we can talk before you build.
2. **Check the decision log** in [docs/community-decisions.md](docs/community-decisions.md). If your change reverses a decision, say so and update the log in the same pull request.
3. **Run the tests** before you open the pull request:

   ```bash
   cd forum
   npm install
   npm run test:unit
   ```

   The end-to-end steps are in [forum/README.md](forum/README.md).
4. **In the pull request description, tell us:**
   - what the change does,
   - which AI tools wrote or helped write it,
   - what you checked yourself,
   - where it might break.

   Shipping something you can't explain is guessing, not building.
5. **Never commit secrets.** Keys and passwords live in Cloudflare, not in this repo.

## License

The code and documentation are released under the [MIT License](LICENSE).

The AngryDucks name and duck logo identify this community. They are published here so the site can use them, but they are not covered by the MIT License.
