# Agents and Value Factories

## Agents

Open **Agents** in the sidebar. Start from a template, or click **Build an agent**. Each section of the builder is one part of the agent's harness.

### Role
The system prompt: who the agent is and how it should work. Keep it short and concrete:

> You are our sales assistant. You qualify leads, move deals forward and write short personal follow-ups. You never promise discounts or terms we have not given you.

databag adds the working rules every agent follows:
- do the work with tools
- never invent customers or numbers
- ask before anything reaches other people

### Model
- **Company AI**: the model set in Settings. By default that is Gemma 4, running on the machine.
- **OpenRouter**, **OpenAI** or **another endpoint** such as LM Studio, vLLM or a second Ollama. Each agent can use its own key and model, so a cheap local model can do the routine work while a stronger hosted model writes your proposals.

The model must support tool calling.

### Tools
Tick what the agent may do in databag. There are about 50 tools across Mail, Calendar, Chat, Contacts, CRM, Projects, Docs, Sheets, Slides, Accounting, Sign and LinkedIn. Each one is marked:
- **reads**: always runs
- **changes data**: runs, or asks first if you turn on *Ask before every change* in Settings
- **reaches people**: always waits for a person's OK, with the text editable

### MCP servers
Add any MCP server that speaks **Streamable HTTP** by its address, plus an optional token. Use **Check connection** to list its tools. Those tools then appear next to databag's own, and by default every use needs approval.

Servers that only run as a local program (stdio) are not started by databag. This prevents anyone using the web page from running programs on the machine. Put such a server behind an HTTP bridge if you need it.

### Skills
A skill is a named playbook: a name, when to use it, and step-by-step instructions. The agent sees the name and summary of every skill, and calls `read_skill` to load the full instructions when a job needs them. This keeps prompts short while still giving the agent your exact procedures.

### Memory
With memory on, the agent can `remember` short facts between jobs (a preference, a decision, a result) and `forget` wrong ones. The latest 40 facts are given to it at the start of each job. You can see and delete them in the Memory section. Don't use memory for secrets.

### Context
Background the agent always knows: what you sell, prices, customers, tone of voice, links.

### Try it
Chat with the saved agent. Approvals appear in the conversation.

## Value Factories

A value factory is a project that agents work on. Open **Value Factories**, click **New factory** and pick a kind:

| Factory | Agent | Starts with |
|---|---|---|
| Campaign | Campaign agent | brief, LinkedIn campaign with draft posts, best-fit leads, first messages, review reminder |
| Sales funnel | Sales agent | warmest deals, leads into the CRM, follow-up drafts, a quote, funnel summary |
| Marketing | Marketing agent | positioning brief, month content plan, first posts |
| Outreach | Outreach agent | ideal customer, 10 best-fit people, personal first messages |
| Branding | Brand agent | tone of voice, key messages, brand presentation |
| New project | Operations agent | project charter, task plan, kickoff reminder |
| Build an app | Builder agent | spec, low-code vs code decision, data sheet, build tasks |
| Process automation | Automation agent | process map, what to automate, automations, manual checklist |
| Blank | (you choose) | describe the goal and **Plan it** writes the tasks |

Then:
1. **Give each task to an agent**, or to *No agent* when a person will do it.
2. Click **Run** on one task, or **Run all** to work down the list. Each agent gets:
   - the factory's goal
   - the task and its notes
   - what earlier tasks produced
3. When an agent wants to do something that reaches other people, the task shows **Needs your OK** with the text, which you can edit. Approve or decline.
4. Finished work shows as **Ready for review**. Read the result and the list of what the agent did, then click **Accept**, or ↻ to run the task again.

Factories are ordinary projects underneath, so they also appear in Projects with the same tasks.

### Ideas
- *Campaign*: launch a product to existing customers.
- *Sales funnel*: weekly pipeline clean-up every Monday.
- *Build an app*: an internal tool. Give the Builder agent a GitHub MCP server and it can open issues and pull requests.
- *Process automation*: monthly invoicing and payment follow-up.
- *Blank*: anything else, such as hiring, an office move or a supplier review.
