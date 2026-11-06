export interface paths {
    "/api/info": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get server info
         * @description Return the server identity, connection URLs, paths, and readiness status.
         */
        get: operations["server.info"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/pair": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create pairing code
         * @description Create a short-lived, single-use code for a /auth/connect/:code pairing link.
         */
        post: operations["server.pair"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/connect/{code}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Redeem pairing code
         * @description Redeem a pairing code. Browsers receive a session cookie and a redirect to the web app; requests that accept JSON receive a session token to use as the password.
         */
        get: operations["server.connect"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/location": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get location
         * @description Resolve the requested location or the server default location.
         */
        get: operations["location.get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/location/reload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reload configuration
         * @description Shut down and rebuild every loaded location. Pending permissions and forms are cancelled; running sessions continue with fresh services at the next step boundary. Emits location.shutdown for client recovery and responds once all replacement builds settle.
         */
        post: operations["location.reload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/agent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List agents
         * @description Retrieve currently registered agents.
         */
        get: operations["agent.list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/agent/{agentID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get agent
         * @description Retrieve a single currently registered agent.
         */
        get: operations["agent.get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/plugin": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List plugins
         * @description Retrieve enabled server plugins and their current status.
         */
        get: operations["plugin.list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/plugin/gui": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read plugin GUI bundle
         * @description Read an active plugin's prebuilt CommonJS `./gui-experimental` bundle. Desktop app windows run its default export; the desktop app's main process runs its `main` export. Fails with not found when no active plugin has the id or the plugin exports no `./gui-experimental`.
         */
        get: operations["plugin.gui"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/plugin/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Check plugin updates
         * @description Check one or all package plugins for available updates.
         */
        post: operations["plugin.check"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/plugin/update": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Update plugins
         * @description Update package plugins concurrently and notify active locations to reload them. Responds once every update has finished; fails when any update fails.
         */
        post: operations["plugin.update"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List sessions
         * @description Retrieve sessions in the requested order. Items keep that order across pages; use cursor.next or cursor.previous to move through the ordered list.
         */
        get: operations["session.list"];
        put?: never;
        /**
         * Create session
         * @description Create a session at the requested location. A parentID creates a linked child session at its parent's location.
         */
        post: operations["session.create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/session/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get session statistics
         * @description Aggregate local session activity, usage, and tool reliability for a time range.
         */
        get: operations["experimental.session.stats"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/session/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Import session
         * @description Import a projected session transcript at the requested location. Accepts transcripts exported by earlier releases. If parentID is supplied, the parent session must already exist; import parents before children.
         */
        post: operations["experimental.session.import"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/session/{sessionID}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Export session
         * @description Export a complete projected session transcript.
         */
        get: operations["experimental.session.export"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/active": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List active sessions
         * @description Retrieve foreground Session drains currently owned by this OpenCode process. Sessions absent from the result are inactive.
         */
        get: operations["session.active"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get session
         * @description Retrieve a session by ID.
         */
        get: operations["session.get"];
        put?: never;
        post?: never;
        /**
         * Delete session
         * @description Delete a session and its child sessions.
         */
        delete: operations["session.remove"];
        options?: never;
        head?: never;
        /**
         * Update session
         * @description Update mutable session properties.
         */
        patch: operations["session.update"];
        trace?: never;
    };
    "/api/session/{sessionID}/fork": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Fork session
         * @description Create a child session by copying projected history before a message. Omit before to copy the full history.
         */
        post: operations["session.fork"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/agent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Switch session agent
         * @description Switch the agent used by subsequent provider turns.
         */
        post: operations["session.switchAgent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/model": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Switch session model
         * @description Switch the model used by subsequent provider turns.
         */
        post: operations["session.switchModel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/move": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Move session
         * @description Move a session to another project directory at the requested delivery boundary.
         */
        post: operations["session.move"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/prompt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Send message
         * @description Durably admit one session input and schedule agent-loop execution unless resume is false.
         */
        post: operations["session.prompt"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/command": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Run command
         * @description Execute a slash command callback immediately.
         */
        post: operations["session.command"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/session/{sessionID}/skill": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Activate skill
         * @description Activate a skill for a session by appending a skill message and resuming execution.
         */
        post: operations["experimental.session.skill"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/synthetic": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add synthetic message
         * @description Durably admit synthetic session input and schedule execution unless resume is false.
         */
        post: operations["session.synthetic"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/shell": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Run shell command
         * @description Execute one shell command in the session's working directory. Emits a shell.started event before execution and a shell.ended event with the merged output after.
         */
        post: operations["session.shell"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/compact": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Compact session
         * @description Durably admit a session compaction request. Steers by default: it runs at the next step boundary instead of waiting behind queued prompts.
         */
        post: operations["session.compact"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/session/{sessionID}/wait": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Wait for session
         * @description Wait for a session agent loop to become idle.
         */
        post: operations["experimental.session.wait"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/revert/stage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Stage session revert
         * @description Stage or move a reversible session boundary and optionally apply its file changes.
         */
        post: operations["session.revert.stage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/revert": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Clear staged revert */
        delete: operations["session.revert.clear"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/revert/commit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Commit staged revert */
        post: operations["session.revert.commit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/context": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get session context
         * @description Retrieve the active context messages for a session (all messages after the last compaction).
         */
        get: operations["session.context"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/diff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Diff session turns
         * @description Structured per-file diffs of the files a turn changed. A turn runs from the first prompt after the session was last idle until its next idle marker, so prompts steered in while it was busy belong to the same turn; `to` extends the range through a later turn. Compares the range's first recorded snapshot with its last; a step still running in the active session compares against the working copy. Ranges that span a location change are rejected. In sessions without any idle marker, a prompt's turn spans until the next user message.
         */
        get: operations["session.diff"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/inbox": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List session inbox
         * @description List durable enqueued session work not yet delivered, ordered by enqueue sequence. Includes user, synthetic, compaction, and move items.
         */
        get: operations["session.inbox.list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/inbox/{inboxID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Cancel inbox input
         * @description Cancel an inbox item that has not yet been delivered. Unavailable items are a no-op.
         */
        delete: operations["session.inbox.cancel"];
        options?: never;
        head?: never;
        /**
         * Update inbox item
         * @description Change a pending inbox item's delivery mode. Steering wakes session execution.
         */
        patch: operations["session.inbox.update"];
        trace?: never;
    };
    "/api/experimental/session/{sessionID}/instructions/entries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List instruction entries
         * @description List API-managed instruction entries attached to the session.
         */
        get: operations["experimental.session.instructions.entry.list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/session/{sessionID}/instructions/entries/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Put instruction entry
         * @description Attach or replace one durable instruction entry. Changes announce as updates at the next step boundary.
         */
        put: operations["experimental.session.instructions.entry.put"];
        post?: never;
        /**
         * Remove instruction entry
         * @description Remove one instruction entry; the removal is announced to the model at the next step boundary.
         */
        delete: operations["experimental.session.instructions.entry.remove"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Generate text from session context
         * @description Generate transient text from the current session context without mutating session history.
         */
        post: operations["session.generate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/session/{sessionID}/log": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read the session log
         * @description Experimental durable session event log. Reads events after an exclusive aggregate sequence and continues with live events when follow=true.
         */
        get: operations["experimental.session.log"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/interrupt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Interrupt session execution
         * @description Interrupt active execution owned by this OpenCode process. Returns interrupted=true when an active execution was interrupted and false for the idle no-op. When resume=true, execution resumes pending steering input and next-in-line control items (manual compaction, moves) while queued prompts remain parked.
         */
        post: operations["session.interrupt"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/background": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Background blocking session tools
         * @description Move active foreground backgroundable tools for this session into background observation. Idle requests are a no-op.
         */
        post: operations["session.background"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/message/{messageID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get session message
         * @description Retrieve one projected message owned by the Session.
         */
        get: operations["session.message.get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/form": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List session forms
         * @description Retrieve pending forms for a session.
         */
        get: operations["session.form.list"];
        put?: never;
        /**
         * Create session form
         * @description Create a form for a session.
         */
        post: operations["session.form.create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/form/{formID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get session form
         * @description Retrieve a form and its current state for a session.
         */
        get: operations["session.form.get"];
        put?: never;
        post?: never;
        /**
         * Cancel form
         * @description Cancel a pending form, optionally telling the asker why it was not answered.
         */
        delete: operations["session.form.cancel"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/form/{formID}/reply": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reply to form
         * @description Submit an answer to a pending form.
         */
        post: operations["session.form.reply"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/environment": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set session environment
         * @description Replace the process environment used by local shell commands for this session.
         */
        put: operations["session.environment"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/view": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * View session
         * @description Mark the idle transition observed by the viewer as viewed.
         */
        post: operations["session.view"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/message": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get session messages
         * @description Retrieve projected messages for a session, optionally filtered by type. Items keep the requested order across pages; use cursor.next or cursor.previous to move through the ordered timeline, passing the same type filter on each page.
         */
        get: operations["session.message.list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/model": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List models
         * @description Retrieve the current snapshot of available models of the requested types, chat by default, ordered by release date within each type. The snapshot may precede initial plugin settlement.
         */
        get: operations["model.list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/model/default": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get default model
         * @description Retrieve the model used when a session has no explicit model selection.
         */
        get: operations["model.default"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/generate/text": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Generate text
         * @description Run one stateless model generation using the server's base configuration and return the assistant text. Uses the base configuration's default model when none is specified.
         */
        post: operations["experimental.generate.text"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Generate text (deprecated path)
         * @deprecated
         * @description Deprecated alias of POST /api/experimental/generate/text.
         */
        post: operations["experimental.generate.textLegacy"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/generate/image": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Generate images
         * @description Generate or edit images with an image model using the server's base configuration and return them as base64. Stateless: nothing is stored.
         */
        post: operations["experimental.generate.image"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/generate/decisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Generate decisions
         * @description Ask a decision model typed predicate, choice and score questions about the input and return one probability-bearing answer per question, in question order. Stateless: nothing is stored.
         */
        post: operations["experimental.generate.decisions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/voice/models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List voice models
         * @description List supported voice models, their transports, and whether the server has a usable API key for each provider.
         */
        get: operations["experimental.voice.models"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/voice/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create voice session
         * @description Create a server-brokered voice session using the server's configured provider credentials and return the WebRTC SDP answer or WebSocket ephemeral token.
         */
        post: operations["experimental.voice.session"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/provider": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List providers
         * @description Retrieve active AI providers so clients can show provider availability and configuration.
         */
        get: operations["provider.list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/provider/{providerID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get provider
         * @description Retrieve a single AI provider so clients can inspect its availability and endpoint settings.
         */
        get: operations["provider.get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/integration": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List integrations
         * @description Retrieve available integrations and their authentication methods.
         */
        get: operations["integration.list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/integration/{integrationID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get integration
         * @description Retrieve one integration and its authentication methods.
         */
        get: operations["integration.get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/integration/wellknown": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add wellknown integration
         * @description Discover and persist an experimental wellknown integration source.
         */
        post: operations["experimental.integration.wellknown.add"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/integration/{integrationID}/connect/key": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Connect with key
         * @description Run a key authentication method and store the resulting credential.
         */
        post: operations["integration.connect.key"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/integration/{integrationID}/connect/external": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Connect with external credentials
         * @description Run an external authentication method and store a reference to its credential source.
         */
        post: operations["integration.connect.external"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/integration/{integrationID}/connect/oauth": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Begin OAuth connection
         * @description Start an OAuth attempt and return the authorization details.
         */
        post: operations["integration.oauth.connect"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/integration/{integrationID}/connect/oauth/{attemptID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get OAuth attempt status
         * @description Poll the current status of an OAuth attempt.
         */
        get: operations["integration.oauth.status"];
        put?: never;
        post?: never;
        /**
         * Cancel OAuth connection
         * @description Cancel an OAuth attempt and release its resources.
         */
        delete: operations["integration.oauth.cancel"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/integration/{integrationID}/connect/oauth/{attemptID}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Complete OAuth connection
         * @description Complete a code-based OAuth attempt and store the resulting credential. For an automatic attempt with `paste`, `code` is the redirect URL copied from the browser, and the result arrives through the attempt status.
         */
        post: operations["integration.oauth.complete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/integration/{integrationID}/connect/command": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Begin command connection
         * @description Start a command authentication attempt.
         */
        post: operations["integration.command.connect"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/integration/{integrationID}/connect/command/{attemptID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get command attempt status
         * @description Poll the current status and output of a command authentication attempt.
         */
        get: operations["integration.command.status"];
        put?: never;
        post?: never;
        /**
         * Cancel command connection
         * @description Cancel a command authentication attempt and terminate its process.
         */
        delete: operations["integration.command.cancel"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/mcp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List MCP servers
         * @description Retrieve configured MCP servers and their connection status.
         */
        get: operations["mcp.list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/mcp/{server}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Add MCP server
         * @description Add an MCP server at runtime or replace an existing one, connecting it immediately.
         */
        put: operations["experimental.mcp.add"];
        post?: never;
        /**
         * Remove MCP server
         * @description Stop an MCP server and remove it from the runtime set until restart.
         */
        delete: operations["experimental.mcp.remove"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/mcp/{server}/connect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Connect MCP server
         * @description Connect an MCP server at runtime, overriding a disabled configuration until restart.
         */
        post: operations["experimental.mcp.connect"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/mcp/{server}/disconnect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Disconnect MCP server
         * @description Disconnect an MCP server at runtime, removing its tools until reconnected.
         */
        post: operations["experimental.mcp.disconnect"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/mcp/resource": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List MCP resources
         * @description Retrieve resources and resource templates from connected MCP servers.
         */
        get: operations["mcp.resource.catalog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/client-mcp/token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create client MCP WebSocket token
         * @description Create a short-lived single-use ticket for opening a client MCP WebSocket connection from a browser.
         */
        post: operations["experimental.mcp.client.token"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/client-mcp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Attach client MCP server
         * @description Upgrade to a WebSocket over which the client hosts an MCP server named after `name`; its tools stay available while the socket is open. One JSON-RPC message per text frame. Experimental: may change without compatibility guarantees.
         */
        get: operations["experimental.mcp.client"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/credential": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List credentials
         * @description List every stored integration credential, including its secret value.
         */
        get: operations["credential.list"];
        put?: never;
        /**
         * Create credential
         * @description Store an integration credential. It becomes the integration's active credential unless activate is false and the integration already has one. Fails with a conflict when the requested ID already exists, and with an invalid request when an `integration.connect` policy denies the integration.
         */
        post: operations["credential.create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/credential/{credentialID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove credential
         * @description Remove a stored integration credential.
         */
        delete: operations["credential.remove"];
        options?: never;
        head?: never;
        /**
         * Update credential
         * @description Update a stored credential label.
         */
        patch: operations["credential.update"];
        trace?: never;
    };
    "/api/credential/{credentialID}/activate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Activate credential
         * @description Activate a stored integration credential.
         */
        post: operations["credential.activate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/project": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List projects
         * @description List known projects. Archived projects are excluded unless archived=true.
         */
        get: operations["project.list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/project/{projectID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update project
         * @description Update the project canonical directory, display metadata, and workspace commands.
         */
        patch: operations["project.update"];
        trace?: never;
    };
    "/api/form": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List pending forms
         * @description Retrieve pending forms for a location.
         */
        get: operations["form.list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/permission/request": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List pending permission requests
         * @description Retrieve pending permission requests for a location.
         */
        get: operations["permission.request.list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/permission/saved": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List saved permissions
         * @description Retrieve saved permissions, optionally filtered by project.
         */
        get: operations["permission.saved.list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/permission/saved/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove saved permission
         * @description Remove a saved permission by ID.
         */
        delete: operations["permission.saved.remove"];
        options?: never;
        head?: never;
        /**
         * Update saved permission
         * @description Change the action or resource of a saved permission. Fails with a conflict when the project already has a saved permission with the same action and resource.
         */
        patch: operations["permission.saved.update"];
        trace?: never;
    };
    "/api/session/{sessionID}/permission": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List session permission requests
         * @description Retrieve pending permission requests owned by a session.
         */
        get: operations["session.permission.list"];
        put?: never;
        /**
         * Create permission request
         * @description Evaluate and, when approval is required, create a permission request for a session.
         */
        post: operations["session.permission.create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/permission/{requestID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get permission request
         * @description Retrieve a pending permission request owned by a session.
         */
        get: operations["session.permission.get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session/{sessionID}/permission/{requestID}/reply": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reply to pending permission request
         * @description Respond to a pending permission request owned by a session.
         */
        post: operations["session.permission.reply"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/fs/read/*": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read file
         * @description Stream one file relative to the requested location with ETag, Last-Modified, and single-range HTTP Range support (206 Partial Content, 416 Range Not Satisfiable, and 304 Not Modified; multi-range and malformed Range headers fall back to 200).
         */
        get: operations["fs.read"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/fs/list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List directory
         * @description List direct children using an absolute path or a path relative to the requested location, including parents and siblings outside its directory. Entry paths remain relative to the requested location; listing does not switch locations.
         */
        get: operations["fs.list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/fs/find": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Find files
         * @description Find recursively ranked filesystem entries relative to the requested location.
         */
        get: operations["fs.find"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/fs/write": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Write file
         * @description Write the raw request body to an absolute path or a path relative to the requested location, creating parent directories, and return the resolved absolute path. Unlike read, the target is not confined to the location. Experimental: may change without compatibility guarantees.
         */
        post: operations["experimental.fs.write"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/fs/watch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Watch file
         * @description Watch one file relative to the requested location for 24 hours, publishing filesystem.changed on that location when it changes. Watching an already watched file resets its expiry. Paths follow read confinement. Experimental: may change without compatibility guarantees.
         */
        post: operations["experimental.fs.watch"];
        /**
         * Unwatch file
         * @description Stop watching one file relative to the requested location. Experimental: may change without compatibility guarantees.
         */
        delete: operations["experimental.fs.unwatch"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/command": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List commands
         * @description Retrieve currently registered commands.
         */
        get: operations["command.list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/skill": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List skills
         * @description Retrieve currently registered skills.
         */
        get: operations["skill.list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/rpc/{rpcID}/{method}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Call a plugin RPC
         * @description Dispatch a method to the currently registered RPC at the requested location.
         */
        post: operations["rpc.call"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/event": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Subscribe to events
         * @description Subscribe to native events and plugin RPC events across all server locations. Volatile by contract: a slow consumer overflows and fails the stream, and events during disconnection are missed.
         */
        get: operations["event.subscribe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/pty": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List PTY sessions
         * @description List PTY sessions for a location, including exited sessions retained until removal.
         */
        get: operations["pty.list"];
        put?: never;
        /**
         * Create PTY session
         * @description Create a pseudo-terminal session for a location.
         */
        post: operations["pty.create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/pty/{ptyID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get PTY session
         * @description Get one PTY session, including its exit code once exited.
         */
        get: operations["pty.get"];
        /**
         * Update PTY session
         * @description Update the title or viewport size of one PTY session.
         */
        put: operations["pty.update"];
        post?: never;
        /**
         * Remove PTY session
         * @description Terminate and remove one PTY session.
         */
        delete: operations["pty.remove"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/pty/{ptyID}/connect-token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create PTY WebSocket token
         * @description Create a short-lived single-use ticket for opening a PTY WebSocket connection.
         */
        post: operations["pty.connect.token"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/pty/{ptyID}/connect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Connect to PTY session
         * @description Establish a WebSocket connection streaming PTY output and accepting terminal input.
         */
        get: operations["pty.connect"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/session/{sessionID}/terminal/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read the session's most recently controlled terminal
         * @description Read the last physical rows without changing selection or taking control. Omitted lines uses the live terminal height; larger counts include retained history. Blank rows are preserved. Screen dimensions and cursor remain relative to the live screen. Returns null when no current terminal exists. Selection is server-local and resets on restart. Experimental: may change without compatibility guarantees.
         */
        get: operations["experimental.persistentPty.read"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/session/{sessionID}/terminal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["experimental.persistentPty.list"];
        put?: never;
        post: operations["experimental.persistentPty.create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/persistent-pty/shutdown": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["experimental.persistentPty.shutdown"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/persistent-pty/handoff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["experimental.persistentPty.handoff"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/persistent-pty/{ptyID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["experimental.persistentPty.get"];
        /** @description Resize when size is present and rename when title is present; a null title clears the user title so the shell's title shows again. Renaming fails with 501 while the terminal service predates renaming. */
        put: operations["experimental.persistentPty.update"];
        post?: never;
        delete: operations["experimental.persistentPty.remove"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/persistent-pty/{ptyID}/snapshot": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["experimental.persistentPty.snapshot"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/persistent-pty/{ptyID}/connect-token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["experimental.persistentPty.connectToken"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/persistent-pty/{ptyID}/connect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Connect to a persistent PTY
         * @description Stream persistent PTY output through the OpenCode server.
         */
        get: operations["experimental.persistentPty.connect"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/media/{hash}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read media blob
         * @description Read a content-addressed media blob by SHA-256 hash with immutable Cache-Control, ETag, and 304 Not Modified support. Only blobs a stored message or inbox item still references are served. Experimental: may change without compatibility guarantees.
         */
        get: operations["experimental.media.get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/schedule": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List schedules
         * @description List a Session's schedules, oldest first. Experimental: needs experimental.schedules in the Session's config and may change without notice.
         */
        get: operations["experimental.schedule.list"];
        put?: never;
        /**
         * Create schedule
         * @description Schedule a prompt that wakes the Session once after a delay, at a time, every interval, or on a cron. Experimental: needs experimental.schedules in the Session's config and may change without notice.
         */
        post: operations["experimental.schedule.create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/schedule/{scheduleID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get schedule
         * @description Read one schedule. Experimental: needs experimental.schedules in the Session's config and may change without notice.
         */
        get: operations["experimental.schedule.get"];
        put?: never;
        post?: never;
        /**
         * Delete schedule
         * @description Delete a schedule. Experimental: needs experimental.schedules in the Session's config and may change without notice.
         */
        delete: operations["experimental.schedule.delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/schedule/{scheduleID}/pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Pause schedule
         * @description Stop a schedule from firing until it is resumed. Experimental: needs experimental.schedules in the Session's config and may change without notice.
         */
        post: operations["experimental.schedule.pause"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/schedule/{scheduleID}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Resume schedule
         * @description Resume a paused schedule. A one-shot that fell due while paused fires once; a repeating schedule resumes at its next slot. Experimental: needs experimental.schedules in the Session's config and may change without notice.
         */
        post: operations["experimental.schedule.resume"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/artifacts/providers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List artifact providers
         * @description Return active artifact providers and default. Experimental: needs experimental.artifacts in the Location's config and may change without notice.
         */
        get: operations["experimental.artifacts.providers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/artifacts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List artifacts
         * @description List published artifacts, newest update first. Experimental: needs experimental.artifacts in the Location's config and may change without notice.
         */
        get: operations["experimental.artifacts.list"];
        put?: never;
        /**
         * Create artifact
         * @description Publish a new artifact through the selected or default artifact provider. Experimental: needs experimental.artifacts in the Location's config and may change without notice.
         */
        post: operations["experimental.artifacts.create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/artifacts/{artifactID}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read artifact
         * @description Read an artifact's metadata and file contents. Experimental: needs experimental.artifacts in the Location's config and may change without notice.
         */
        get: operations["experimental.artifacts.get"];
        put?: never;
        post?: never;
        /**
         * Delete artifact
         * @description Remove an artifact and its stored files. Experimental: needs experimental.artifacts in the Location's config and may change without notice.
         */
        delete: operations["experimental.artifacts.delete"];
        options?: never;
        head?: never;
        /**
         * Update artifact
         * @description Replace an artifact's files at the same ID and URL. Experimental: needs experimental.artifacts in the Location's config and may change without notice.
         */
        patch: operations["experimental.artifacts.update"];
        trace?: never;
    };
    "/api/experimental/artifacts/{artifactID}/view/*": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * View local artifact
         * @description Serve HTML and static files from the local provider. Experimental: needs experimental.artifacts in the Location's config and may change without notice.
         */
        get: operations["experimental.artifacts.view"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/job": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List background jobs
         * @description List active and unconsumed background jobs, optionally filtered by owning session, descendants, or kind. Experimental: may change without compatibility guarantees.
         */
        get: operations["experimental.job.list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/shell": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List running shell commands
         * @description List currently running shell commands for a location. Exited commands are not included.
         */
        get: operations["shell.list"];
        put?: never;
        /**
         * Run shell command
         * @description Spawn one non-interactive shell command for a location. Combined stdout/stderr is captured to a file pageable via output.
         */
        post: operations["shell.create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/shell/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get shell command
         * @description Get one shell command, including its status and exit code once exited.
         */
        get: operations["shell.get"];
        put?: never;
        post?: never;
        /**
         * Remove shell command
         * @description Terminate and remove one shell command and its retained output.
         */
        delete: operations["shell.remove"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/shell/{id}/output": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read shell output
         * @description Page through captured combined output by absolute byte cursor.
         */
        get: operations["shell.output"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/reference": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List references
         * @description List references available in the requested location.
         */
        get: operations["reference.list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worktree": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List worktrees
         * @description Return the project's saved worktree inventory without loading configuration or running discovery.
         */
        get: operations["worktree.list"];
        put?: never;
        /**
         * Create worktree
         * @description Load the project's canonical configuration, create a local worktree using its selected strategy, then run the project's setup script.
         */
        post: operations["worktree.create"];
        /**
         * Remove worktree
         * @description Load the project's canonical configuration and remove a saved worktree using its recorded strategy.
         */
        delete: operations["worktree.remove"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worktree/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Refresh worktrees
         * @description Load the project's canonical configuration, discover worktrees across known checkout roots using all available strategies, and reconcile saved state.
         */
        post: operations["worktree.refresh"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/vcs/init": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Initialize VCS repository
         * @description Initialize a repository using the selected VCS provider in a markerless project's directory and refresh its location services. Omitting provider defaults to git; built-in git and hg providers support initialization. An unknown provider returns 400; a registered provider without init returns 501.
         */
        post: operations["vcs.init"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/vcs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * VCS info
         * @description Get current and default branch information for the requested location.
         */
        get: operations["vcs.get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/vcs/base": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * VCS review base
         * @description Infer a local review base from named branch creation history, or the repository default only when currently on that branch. Returns null before the first commit or when the provider lacks base metadata; ambiguous Git history requires an explicit base on diff requests.
         */
        get: operations["vcs.base"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/vcs/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * VCS status
         * @description List uncommitted working-copy changes relative to the requested location.
         */
        get: operations["vcs.status"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/vcs/branch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * VCS branches
         * @description List local and remote branches available at the requested location.
         */
        get: operations["vcs.branch.list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/vcs/diff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * VCS diff
         * @description Diff HEAD to the working copy (working), the base merge-base to the working copy (branch), or the base merge-base to HEAD (committed). Omitting base preserves repository-default comparison; supplying it overrides the comparison without saving it.
         */
        get: operations["vcs.diff"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/debug/heap-dump": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Write a heap snapshot
         * @description Write a JavaScript heap snapshot of the server process into its log directory, or the requested directory, and return the server-local path once the file is complete. Pauses the server while the heap serializes and can temporarily increase its memory use. The snapshot can contain credentials, prompts, and file contents.
         */
        post: operations["debug.heapDump"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/debug/location": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List loaded locations
         * @description List locations currently loaded by the server.
         */
        get: operations["debug.location.list"];
        put?: never;
        post?: never;
        /**
         * Evict a loaded location
         * @description Dispose the requested location's cached services so its next use boots them fresh.
         */
        delete: operations["debug.location.evict"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/migration/v1": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get V1 migration status
         * @description Return the progress of the V1 to V2 session history migration.
         */
        get: operations["experimental.migration.v1.status"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/websearch/provider": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List web search providers
         * @description Return the registered web search providers.
         */
        get: operations["websearch.providers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/websearch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Search the web
         * @description Run one web search through the selected provider. Specify a provider to override the configured default.
         */
        post: operations["websearch.query"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/usage/limits": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get usage limits
         * @description Return the OpenCode Go allowance and Console budgets of the OpenCode Console workspace the location is signed in to, or null when it isn't signed in.
         */
        get: operations["experimental.usage.limits"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get configuration
         * @description Return configuration documents and discovery sources for the requested location, from lowest to highest priority.
         */
        get: operations["config.get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/config/shell": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List available shells
         * @description Return shells available to terminal and agent execution.
         */
        get: operations["config.shells"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/experimental/config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update global configuration
         * @description Patch supported fields in the highest-precedence global configuration document.
         */
        patch: operations["experimental.config.update"];
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        AbsolutePath: string;
        "Agent.Color": string;
        "Agent.ID": string;
        "Agent.Info": {
            id: components["schemas"]["Agent.ID"];
            name: string;
            model?: components["schemas"]["Model.Ref"];
            request: components["schemas"]["Provider.Request"];
            system?: string;
            description?: string;
            /** @enum {string} */
            mode: "subagent" | "primary" | "all";
            hidden: boolean;
            color?: components["schemas"]["Agent.Color"];
            steps?: number;
            permissions: components["schemas"]["Permission.Ruleset"];
        };
        AgentNotFoundErrorEncoded: {
            /** @enum {string} */
            _tag: "AgentNotFoundError";
            agentID: string;
            message: string;
        };
        /** @enum {string} */
        "Artifact.Capability": "static" | "server-code" | "sqlite" | "durable-objects";
        "Artifact.Content": {
            info: components["schemas"]["Artifact.Info"];
            files: {
                [key: string]: string;
            };
        };
        "Artifact.CreateInput": {
            title: string;
            files: {
                [key: string]: string;
            };
            entry?: string;
            provider?: string;
            sessionID?: components["schemas"]["Session.ID"];
        };
        "Artifact.ID": string;
        "Artifact.Info": {
            id: components["schemas"]["Artifact.ID"];
            provider: components["schemas"]["Artifact.ProviderIDEncoded"];
            sessionID?: components["schemas"]["Session.ID"];
            title: string;
            entry: string;
            url: string;
            time: components["schemas"]["Artifact.Time"];
        };
        "Artifact.Provider": {
            id: components["schemas"]["Artifact.ProviderIDEncoded"];
            name: string;
            capabilities: components["schemas"]["Artifact.Capability"][];
            default: boolean;
        };
        "Artifact.ProviderIDEncoded": string;
        "Artifact.Time": {
            created: number;
            updated: number;
        };
        "Artifact.UpdateInput": {
            title?: string;
            files: {
                [key: string]: string;
            };
            entry?: string;
            sessionID?: components["schemas"]["Session.ID"];
        };
        ArtifactNotFoundErrorEncoded: {
            /** @enum {string} */
            _tag: "ArtifactNotFoundError";
            artifactID: string;
            message: string;
        };
        "Command.Info": {
            name: string;
            description?: string;
        };
        CommandExecutionErrorEncoded: {
            /** @enum {string} */
            _tag: "CommandExecutionError";
            command: string;
            message: string;
        };
        CommandNotFoundErrorEncoded: {
            /** @enum {string} */
            _tag: "CommandNotFoundError";
            command: string;
            message: string;
        };
        "Config.AgentEncoded": {
            model?: string | {
                providerID: string;
                model: string;
                variant?: string;
            };
            request?: {
                headers?: {
                    [key: string]: string;
                };
                body?: Record<string, never>;
            };
            system?: string;
            description?: string;
            /** @enum {string} */
            mode?: "subagent" | "primary" | "all";
            hidden?: boolean;
            color?: string;
            steps?: number;
            disabled?: boolean;
            permissions?: components["schemas"]["Permission.Ruleset"];
        };
        "Config.CommandEncoded": {
            template: string;
            description?: string;
            agent?: string;
            model?: string | {
                providerID: string;
                model: string;
                variant?: string;
            };
            subagent?: boolean;
            /** @description Deprecated alias for subagent. */
            subtask?: boolean;
        };
        "Config.Compaction.Percent": string;
        "Config.DirectoryEncoded": {
            /** @enum {string} */
            type: "directory";
            path: components["schemas"]["AbsolutePath"];
        };
        "Config.DocumentEncoded": {
            /** @enum {string} */
            type: "document";
            path?: components["schemas"]["AbsolutePath"];
            info: components["schemas"]["Config.InfoEncoded"];
        };
        "Config.Entry": components["schemas"]["Config.DocumentEncoded"] | components["schemas"]["Config.DirectoryEncoded"];
        "Config.Formatter.EntryEncoded": {
            disabled?: boolean;
            command?: string[];
            environment?: {
                [key: string]: string;
            };
            extensions?: string[];
        };
        "Config.InfoEncoded": {
            $schema?: string;
            shell?: string;
            model?: string | {
                providerID: string;
                model: string;
                variant?: string;
            };
            default_agent?: string;
            /** @enum {string} */
            update?: "disable" | "notify" | "auto";
            /** @enum {string} */
            share?: "manual" | "auto" | "disabled";
            enterprise?: {
                url?: string;
            };
            username?: string;
            timezone?: string;
            permissions?: components["schemas"]["Permission.Ruleset"];
            policies?: {
                /** @enum {string} */
                action: "provider.use" | "tool.use" | "integration.connect" | "integration.use" | "mcp.use" | "skill.use" | "plugin.use" | "websearch.use";
                resource: string;
                /** @enum {string} */
                effect: "allow" | "deny";
            }[];
            agents?: {
                [key: string]: components["schemas"]["Config.AgentEncoded"];
            };
            snapshots?: boolean;
            watcher?: {
                ignore?: string[];
            };
            formatter?: boolean | {
                [key: string]: components["schemas"]["Config.Formatter.EntryEncoded"];
            };
            lsp?: boolean | {
                [key: string]: {
                    /** @enum {boolean} */
                    disabled: true;
                } | components["schemas"]["Config.LSP.ServerEncoded"];
            };
            media?: {
                image?: {
                    auto_resize?: boolean;
                    max_width?: number;
                    max_height?: number;
                    max_base64_bytes?: number;
                };
            };
            tool_output?: {
                max_lines?: number;
                max_bytes?: number;
            };
            mcp?: {
                timeout?: {
                    startup?: number;
                    catalog?: number;
                    execution?: number;
                };
                servers?: {
                    [key: string]: components["schemas"]["Mcp.LocalConfigEncoded"] | components["schemas"]["Mcp.RemoteConfigEncoded"];
                };
            };
            compaction?: {
                auto?: boolean;
                keep?: {
                    tokens?: number;
                };
                buffer?: components["schemas"]["Config.Compaction.Percent"] | number;
            };
            skills?: string[];
            commands?: {
                [key: string]: components["schemas"]["Config.CommandEncoded"];
            };
            instructions?: string[];
            references?: {
                [key: string]: string | components["schemas"]["Config.Reference.GitEncoded"] | components["schemas"]["Config.Reference.LocalEncoded"];
            };
            websearch?: false | components["schemas"]["ConfigWebSearch.InfoEncoded"];
            plugins?: (string | components["schemas"]["Config.Plugin.EntryEncoded"])[];
            worktree?: components["schemas"]["Config.Worktree"];
            warming?: boolean | components["schemas"]["Config.WarmingEncoded"];
            providers?: {
                [key: string]: components["schemas"]["Config.ProviderEncoded"];
            };
            experimental?: {
                portable_shell_scanner?: boolean;
                all_flags?: boolean;
                todo?: boolean;
                background_compaction?: boolean;
                media_blob?: boolean;
                schedules?: boolean;
                artifacts?: boolean;
                part_rows?: boolean;
                image_generate?: boolean | {
                    model?: string | {
                        providerID: string;
                        model: string;
                        variant?: string;
                    };
                };
                subagent_depth?: number;
                location_idle_timeout?: string | false;
                policies?: {
                    /** @enum {string} */
                    action: "provider.use" | "tool.use" | "integration.connect" | "integration.use" | "mcp.use" | "skill.use" | "plugin.use" | "websearch.use";
                    resource: string;
                    /** @enum {string} */
                    effect: "allow" | "deny";
                }[];
            };
        };
        "Config.LSP.ServerEncoded": {
            command: string[];
            extensions?: string[];
            disabled?: boolean;
            env?: {
                [key: string]: string;
            };
            initialization?: Record<string, never>;
        };
        "Config.Model.Capabilities": {
            tools?: boolean;
            input?: string[];
            output?: string[];
            temperature?: boolean;
            reasoning?: components["schemas"]["Config.Model.Reasoning"];
        };
        "Config.Model.CostEncoded": {
            tier?: {
                /** @enum {string} */
                type: "context";
                size: number;
            };
            input: components["schemas"]["Money.USDPerMillionTokens"];
            output: components["schemas"]["Money.USDPerMillionTokens"];
            cache?: {
                read?: components["schemas"]["Money.USDPerMillionTokens"];
                write?: components["schemas"]["Money.USDPerMillionTokens"];
            };
        };
        "Config.Model.Reasoning": {
            /** @enum {boolean} */
            supported: false;
        } | {
            /** @enum {boolean} */
            supported: true;
            toggle?: boolean;
            effort?: string[];
            budget?: {
                min?: number;
                max?: number;
            };
        };
        "Config.Model.Settings": {
            compaction?: components["schemas"]["Provider.Compaction"];
            cache?: components["schemas"]["Provider.Cache"];
            encoding?: components["schemas"]["Provider.Encoding"];
        } & {
            [key: string]: unknown | null;
        };
        "Config.Model.VariantSettings": {
            compaction?: components["schemas"]["Provider.Compaction"];
            encoding?: components["schemas"]["Provider.Encoding"];
        } & {
            [key: string]: unknown | null;
        };
        "Config.ModelEncoded": {
            modelID?: string;
            type?: components["schemas"]["Model.Type"];
            family?: string;
            name?: string;
            /** @description Release date as YYYY-MM-DD or YYYY-MM */
            releaseDate?: string;
            compatibility?: components["schemas"]["Model.Compatibility"];
            package?: string;
            settings?: components["schemas"]["Config.Model.Settings"];
            headers?: {
                [key: string]: string;
            };
            body?: Record<string, never>;
            capabilities?: components["schemas"]["Config.Model.Capabilities"];
            variants?: {
                id: string;
                settings?: components["schemas"]["Config.Model.VariantSettings"];
                headers?: {
                    [key: string]: string;
                };
                body?: Record<string, never>;
            }[];
            cost?: components["schemas"]["Config.Model.CostEncoded"] | components["schemas"]["Config.Model.CostEncoded"][];
            disabled?: boolean;
            limit?: {
                context?: number;
                input?: number;
                output?: number;
            };
        };
        "Config.Patch": {
            shell: string | null;
        };
        "Config.Plugin.EntryEncoded": {
            package: string;
            options?: Record<string, never>;
        };
        "Config.Provider.Settings": {
            timeout?: number | false;
            headerTimeout?: number | false;
            chunkTimeout?: number | false;
            compaction?: components["schemas"]["Provider.Compaction"];
            cache?: components["schemas"]["Provider.Cache"];
            transport?: components["schemas"]["Provider.Transport"];
            encoding?: components["schemas"]["Provider.Encoding"];
        } & {
            [key: string]: unknown | null;
        };
        "Config.ProviderEncoded": {
            canonical?: components["schemas"]["Provider.ID"];
            name?: string;
            env?: string[];
            package?: string;
            compatibility?: components["schemas"]["Provider.Compatibility"];
            settings?: components["schemas"]["Config.Provider.Settings"];
            headers?: {
                [key: string]: string;
            };
            body?: Record<string, never>;
            models?: {
                [key: string]: components["schemas"]["Config.ModelEncoded"];
            };
        };
        "Config.Reference.GitEncoded": {
            repository: string;
            branch?: string;
            description?: string;
            hidden?: boolean;
        };
        "Config.Reference.LocalEncoded": {
            path: string;
            description?: string;
            hidden?: boolean;
        };
        "Config.WarmingEncoded": {
            prompt?: string;
            interval?: "auto" | string;
            duration?: string;
        };
        "Config.Worktree": {
            directory: string;
        };
        "ConfigShell.Option": {
            path: string;
            name: string;
            acceptable: boolean;
        };
        "ConfigWebSearch.InfoEncoded": {
            provider: "random" | components["schemas"]["WebSearch.ID"];
        };
        ConflictErrorEncoded: {
            /** @enum {string} */
            _tag: "ConflictError";
            message: string;
            resource?: string | null;
        };
        "Connection.CredentialInfo": {
            /** @enum {string} */
            type: "credential";
            id: components["schemas"]["Credential.ID"];
            label: string;
            /** @enum {string} */
            method: "key" | "oauth" | "external";
            status?: components["schemas"]["Connection.Status"];
        };
        "Connection.EnvInfo": {
            /** @enum {string} */
            type: "env";
            name: string;
            status?: components["schemas"]["Connection.Status"];
        };
        "Connection.Info": components["schemas"]["Connection.CredentialInfo"] | components["schemas"]["Connection.EnvInfo"];
        "Connection.Status": {
            status: "needs_auth";
            message: string;
            url?: string;
        };
        "Credential.CreateInput": {
            id?: components["schemas"]["Credential.ID"];
            integrationID: components["schemas"]["Integration.ID"];
            label?: string;
            value: components["schemas"]["Credential.Value"];
            activate?: boolean;
        };
        "Credential.Entry": {
            id: components["schemas"]["Credential.ID"];
            integrationID: components["schemas"]["Integration.ID"];
            label: string;
            active: boolean;
            value: components["schemas"]["Credential.Value"];
        };
        "Credential.External": {
            /** @enum {string} */
            type: "external";
            methodID: components["schemas"]["Integration.MethodID"];
            metadata?: Record<string, never>;
        };
        "Credential.ID": string;
        "Credential.Key": {
            /** @enum {string} */
            type: "key";
            key: string;
            metadata?: Record<string, never>;
        };
        "Credential.OAuth": {
            /** @enum {string} */
            type: "oauth";
            methodID: components["schemas"]["Integration.MethodID"];
            refresh: string;
            access: string;
            expires: number;
            metadata?: Record<string, never>;
        };
        "Credential.Value": components["schemas"]["Credential.OAuth"] | components["schemas"]["Credential.Key"] | components["schemas"]["Credential.External"];
        "Event.ID": string;
        "Event.Seq": number;
        /** @enum {number} */
        "Event.VersionEncoded_c3ea984aceae": 2;
        /** @enum {number} */
        "Event.VersionEncoded_c77c5abcb68d": 1;
        /** @description Marker emitted once when a log read reaches its captured watermark. The reader holds every event committed at or below seq. */
        "EventLog.Synced": {
            /** @enum {string} */
            type: "log.synced";
            aggregateID: string;
            seq?: components["schemas"]["Event.Seq"];
        };
        "FileDiff.Info": {
            file: string;
            patch: string;
            additions: number;
            deletions: number;
            /** @enum {string} */
            status: "added" | "deleted" | "modified";
            /** @enum {boolean} */
            more?: true;
        };
        FileNotFoundErrorEncoded: {
            /** @enum {string} */
            _tag: "FileNotFoundError";
            path: string;
            message: string;
        };
        "FileSystem.Entry": {
            path: components["schemas"]["RelativePath"];
            /** @enum {string} */
            type: "file" | "directory";
        };
        "FileSystem.Write": {
            path: components["schemas"]["AbsolutePath"];
        };
        ForbiddenErrorEncoded: {
            /** @enum {string} */
            _tag: "ForbiddenError";
            message: string;
        };
        "Form.Answer": {
            [key: string]: components["schemas"]["Form.Value"];
        };
        "Form.Answer_1": {
            [key: string]: components["schemas"]["Form.Value_1"];
        };
        "Form.BooleanField": {
            key: string;
            title?: string;
            description?: string;
            required?: boolean;
            hidden?: boolean;
            when?: components["schemas"]["Form.When"][];
            /** @enum {string} */
            type: "boolean";
            default?: boolean;
        };
        "Form.BooleanField_1": {
            key: string;
            title?: string;
            description?: string;
            required?: boolean;
            hidden?: boolean;
            when?: components["schemas"]["Form.When_1"][];
            /** @enum {string} */
            type: "boolean";
            default?: boolean;
        };
        "Form.CreatePayload": {
            id?: components["schemas"]["Form.ID"] | null;
            title: string;
            metadata?: components["schemas"]["Form.Metadata"];
            fields: components["schemas"]["Form.Fields"];
        };
        "Form.Detail": {
            id: components["schemas"]["Form.ID"];
            sessionID: string;
            title: string;
            metadata?: components["schemas"]["Form.Metadata"];
            fields: components["schemas"]["Form.Fields"];
            state: components["schemas"]["Form.State"];
        };
        "Form.ExternalField": {
            key: string;
            /** @enum {string} */
            type: "external";
            url: string;
            title?: string;
            description?: string;
        };
        "Form.Field": components["schemas"]["Form.StringField"] | components["schemas"]["Form.NumberField"] | components["schemas"]["Form.IntegerField"] | components["schemas"]["Form.BooleanField"] | components["schemas"]["Form.MultiselectField"] | components["schemas"]["Form.ExternalField"];
        "Form.Field_1": components["schemas"]["Form.StringField_1"] | components["schemas"]["Form.NumberField_1"] | components["schemas"]["Form.IntegerField_1"] | components["schemas"]["Form.BooleanField_1"] | components["schemas"]["Form.MultiselectField_1"] | components["schemas"]["Form.ExternalField"];
        "Form.Fields": [
            components["schemas"]["Form.Field"]
        ];
        "Form.Fields_1": [
            components["schemas"]["Form.Field_1"]
        ];
        "Form.ID": string;
        "Form.Info": {
            id: components["schemas"]["Form.ID"];
            sessionID: string;
            title: string;
            metadata?: components["schemas"]["Form.Metadata"];
            fields: components["schemas"]["Form.Fields"];
        };
        "Form.Info_1": {
            id: components["schemas"]["Form.ID"];
            sessionID: string;
            title: string;
            metadata?: components["schemas"]["Form.Metadata"];
            fields: components["schemas"]["Form.Fields_1"];
        };
        "Form.IntegerField": {
            key: string;
            title?: string;
            description?: string;
            required?: boolean;
            hidden?: boolean;
            when?: components["schemas"]["Form.When"][];
            /** @enum {string} */
            type: "integer";
            minimum?: number | ("Infinity" | "-Infinity" | "NaN");
            maximum?: number | ("Infinity" | "-Infinity" | "NaN");
            default?: number | ("Infinity" | "-Infinity" | "NaN");
        };
        "Form.IntegerField_1": {
            key: string;
            title?: string;
            description?: string;
            required?: boolean;
            hidden?: boolean;
            when?: components["schemas"]["Form.When_1"][];
            /** @enum {string} */
            type: "integer";
            minimum?: number | ("NaN" | "Infinity" | "-Infinity");
            maximum?: number | ("NaN" | "Infinity" | "-Infinity");
            default?: number | ("NaN" | "Infinity" | "-Infinity");
        };
        "Form.Metadata": Record<string, never>;
        "Form.MultiselectField": {
            key: string;
            title?: string;
            description?: string;
            required?: boolean;
            hidden?: boolean;
            when?: components["schemas"]["Form.When"][];
            /** @enum {string} */
            type: "multiselect";
            options: components["schemas"]["Form.Option"][];
            minItems?: number;
            maxItems?: number;
            custom?: boolean;
            default?: string[];
        };
        "Form.MultiselectField_1": {
            key: string;
            title?: string;
            description?: string;
            required?: boolean;
            hidden?: boolean;
            when?: components["schemas"]["Form.When_1"][];
            /** @enum {string} */
            type: "multiselect";
            options: components["schemas"]["Form.Option"][];
            minItems?: number;
            maxItems?: number;
            custom?: boolean;
            default?: string[];
        };
        "Form.NumberField": {
            key: string;
            title?: string;
            description?: string;
            required?: boolean;
            hidden?: boolean;
            when?: components["schemas"]["Form.When"][];
            /** @enum {string} */
            type: "number";
            minimum?: number | ("Infinity" | "-Infinity" | "NaN");
            maximum?: number | ("Infinity" | "-Infinity" | "NaN");
            default?: number | ("Infinity" | "-Infinity" | "NaN");
        };
        "Form.NumberField_1": {
            key: string;
            title?: string;
            description?: string;
            required?: boolean;
            hidden?: boolean;
            when?: components["schemas"]["Form.When_1"][];
            /** @enum {string} */
            type: "number";
            minimum?: number | ("NaN" | "Infinity" | "-Infinity");
            maximum?: number | ("NaN" | "Infinity" | "-Infinity");
            default?: number | ("NaN" | "Infinity" | "-Infinity");
        };
        "Form.Option": {
            value: string;
            label: string;
            description?: string;
        };
        "Form.Reply": {
            answer: components["schemas"]["Form.Answer"];
        };
        "Form.State": {
            /** @enum {string} */
            status: "pending";
        } | {
            /** @enum {string} */
            status: "answered";
            answer: components["schemas"]["Form.Answer"];
        } | {
            /** @enum {string} */
            status: "cancelled";
            message?: string;
        };
        "Form.StringField": {
            key: string;
            title?: string;
            description?: string;
            required?: boolean;
            hidden?: boolean;
            when?: components["schemas"]["Form.When"][];
            /** @enum {string} */
            type: "string";
            /** @enum {string} */
            format?: "email" | "uri" | "date" | "date-time";
            minLength?: number;
            maxLength?: number;
            pattern?: string;
            placeholder?: string;
            default?: string;
            options?: components["schemas"]["Form.Option"][];
            custom?: boolean;
        };
        "Form.StringField_1": {
            key: string;
            title?: string;
            description?: string;
            required?: boolean;
            hidden?: boolean;
            when?: components["schemas"]["Form.When_1"][];
            /** @enum {string} */
            type: "string";
            /** @enum {string} */
            format?: "email" | "uri" | "date" | "date-time";
            minLength?: number;
            maxLength?: number;
            pattern?: string;
            placeholder?: string;
            default?: string;
            options?: components["schemas"]["Form.Option"][];
            custom?: boolean;
        };
        "Form.Value": string | number | ("Infinity" | "-Infinity" | "NaN") | boolean | string[];
        "Form.Value_1": string | number | ("NaN" | "Infinity" | "-Infinity") | boolean | string[];
        "Form.When": {
            key: string;
            /** @enum {string} */
            op: "eq" | "neq";
            value: string | number | ("Infinity" | "-Infinity" | "NaN") | boolean;
        };
        "Form.When_1": {
            key: string;
            /** @enum {string} */
            op: "eq" | "neq";
            value: string | number | ("NaN" | "Infinity" | "-Infinity") | boolean;
        };
        FormAlreadySettledErrorEncoded: {
            /** @enum {string} */
            _tag: "FormAlreadySettledError";
            id: string;
            message: string;
        };
        FormInvalidAnswerErrorEncoded: {
            /** @enum {string} */
            _tag: "FormInvalidAnswerError";
            id: string;
            message: string;
        };
        FormNotFoundErrorEncoded: {
            /** @enum {string} */
            _tag: "FormNotFoundError";
            id: string;
            message: string;
        };
        "Generate.ChoiceAnswer": {
            /** @enum {string} */
            type: "choice";
            name: string;
            choice: components["schemas"]["Generate.ChoiceValue"];
            probabilities: {
                value: components["schemas"]["Generate.ChoiceValue"];
                probability: number;
            }[];
            confidence: number;
        };
        /** @description Pick one value from a fixed set */
        "Generate.ChoiceQuestion": {
            /** @enum {string} */
            type: "choice";
            /** @description Unique within the request; echoed on the matching answer */
            name: string;
            instructions: string;
            choices: {
                value: components["schemas"]["Generate.ChoiceValue"];
                description?: string;
            }[];
        };
        /** @description Choice values are typed: true and "true" are different values */
        "Generate.ChoiceValue": string | boolean;
        "Generate.DecisionAnswer": components["schemas"]["Generate.PredicateAnswer"] | components["schemas"]["Generate.ChoiceAnswer"] | components["schemas"]["Generate.ScoreAnswer"] | components["schemas"]["Generate.ErrorAnswer"];
        "Generate.DecisionFilePart": {
            /** @enum {string} */
            type: "file";
            data: components["schemas"]["Prompt.Base64"];
            mime: string;
            name?: string;
        };
        "Generate.DecisionJsonPart": {
            /** @enum {string} */
            type: "json";
            value: unknown;
        };
        "Generate.DecisionPart": components["schemas"]["Generate.DecisionTextPart"] | components["schemas"]["Generate.DecisionJsonPart"] | components["schemas"]["Generate.DecisionFilePart"];
        "Generate.DecisionQuestion": components["schemas"]["Generate.PredicateQuestion"] | components["schemas"]["Generate.ChoiceQuestion"] | components["schemas"]["Generate.ScoreQuestion"];
        "Generate.DecisionRequest": {
            model: components["schemas"]["Model.Ref"];
            /** @description The evidence every question is asked about, in order */
            input: components["schemas"]["Generate.DecisionPart"][];
            /** @description Question names must be unique; duplicates fail with InvalidRequestError */
            questions: components["schemas"]["Generate.DecisionQuestion"][];
        };
        "Generate.DecisionResult": {
            /** @description One answer per question, in question order */
            answers: components["schemas"]["Generate.DecisionAnswer"][];
            cost?: components["schemas"]["Money.USD"];
            tokens?: components["schemas"]["Generate.Usage"];
            native?: components["schemas"]["Generate.Native"];
        };
        "Generate.DecisionTextPart": {
            /** @enum {string} */
            type: "text";
            text: string;
        };
        /** @description This one question has no answer; the other answers still came back */
        "Generate.ErrorAnswer": {
            /** @enum {string} */
            type: "error";
            name: string;
            /** @description Why the question has no answer, for example refusal */
            reason: string;
            message?: string;
        };
        "Generate.File": {
            data: components["schemas"]["Prompt.Base64"];
            mime: string;
            name?: string;
        };
        /** @description Aspect ratio as width:height, for example 16:9 */
        "Generate.ImageAspect": string;
        "Generate.ImageOutput": {
            /** @enum {string} */
            type: "image";
            data: components["schemas"]["Prompt.Base64"];
            mime: string;
            name?: string;
        };
        "Generate.ImageRequest": {
            model: components["schemas"]["Model.Ref"];
            prompt: string;
            images?: components["schemas"]["Generate.File"][];
            n?: number;
            aspect?: components["schemas"]["Generate.ImageAspect"];
            resolution?: components["schemas"]["Generate.ImageResolution"];
        };
        /** @description Size tier such as 1K, 2K or 4K; 1K is about as many pixels as 1024x1024 at the requested aspect */
        "Generate.ImageResolution": ("1K" | "2K" | "4K") | string;
        "Generate.ImageResult": {
            images: components["schemas"]["Generate.ImageOutput"][];
            cost?: components["schemas"]["Money.USD"];
            tokens?: components["schemas"]["Generate.Usage"];
            native?: components["schemas"]["Generate.Native"];
        };
        /** @description Provider-specific data the shared fields do not cover */
        "Generate.Native": Record<string, never>;
        "Generate.PredicateAnswer": {
            /** @enum {string} */
            type: "predicate";
            name: string;
            probability: number;
        };
        /** @description The probability that a statement is true */
        "Generate.PredicateQuestion": {
            /** @enum {string} */
            type: "predicate";
            /** @description Unique within the request; echoed on the matching answer */
            name: string;
            instructions: string;
        };
        "Generate.ScoreAnswer": {
            /** @enum {string} */
            type: "score";
            name: string;
            /** @description Probability-weighted level index, so it can fall between levels */
            score: number;
            probabilities: {
                value: number;
                label: string;
                probability: number;
            }[];
            confidence: number;
        };
        /** @description Place the input on ordered levels, lowest first */
        "Generate.ScoreQuestion": {
            /** @enum {string} */
            type: "score";
            /** @description Unique within the request; echoed on the matching answer */
            name: string;
            instructions: string;
            levels: {
                label: string;
                description?: string;
            }[];
        };
        /** @description Token counts, when the provider reports them */
        "Generate.Usage": {
            input?: number;
            output?: number;
        };
        GenerateDecisionsResponse: {
            data: components["schemas"]["Generate.DecisionResult"];
        };
        GenerateImageResponse: {
            data: components["schemas"]["Generate.ImageResult"];
        };
        GenerateTextResponse: {
            data: {
                text: string;
            };
        };
        "Instruction.Hash": string;
        "Instruction.Key": string;
        "InstructionEntry.Info": {
            key: components["schemas"]["InstructionEntry.Key"];
            /** @description JSON value attached to the session's instructions */
            value: unknown;
        };
        /** @description Instruction entry key (lowercase alphanumerics plus . _ -) */
        "InstructionEntry.Key": string;
        "InstructionEntry.Snapshot": {
            key: components["schemas"]["InstructionEntry.Key"];
            /** @description JSON value attached to the session's instructions */
            value: unknown;
            removed: boolean;
        }[];
        InstructionEntryValueTooLargeErrorEncoded: {
            /** @enum {string} */
            _tag: "InstructionEntryValueTooLargeError";
            actualBytes: number;
            maxBytes: number;
            message: string;
        };
        "Integration.AttemptEncoded": {
            attemptID: components["schemas"]["Integration.AttemptID"];
            url: string;
            instructions: string;
            /** @enum {string} */
            mode: "auto" | "code";
            /** @enum {boolean} */
            paste?: true;
            time: {
                created: number | ("Infinity" | "-Infinity" | "NaN");
                expires: number | ("Infinity" | "-Infinity" | "NaN");
            };
        };
        "Integration.AttemptID": string;
        "Integration.AttemptStatus": {
            /** @enum {string} */
            status: "pending";
            time: {
                created: number | ("Infinity" | "-Infinity" | "NaN");
                expires: number | ("Infinity" | "-Infinity" | "NaN");
            };
        } | {
            /** @enum {string} */
            status: "complete";
            time: {
                created: number | ("Infinity" | "-Infinity" | "NaN");
                expires: number | ("Infinity" | "-Infinity" | "NaN");
            };
        } | {
            /** @enum {string} */
            status: "failed";
            message: string;
            time: {
                created: number | ("Infinity" | "-Infinity" | "NaN");
                expires: number | ("Infinity" | "-Infinity" | "NaN");
            };
        } | {
            /** @enum {string} */
            status: "expired";
            time: {
                created: number | ("Infinity" | "-Infinity" | "NaN");
                expires: number | ("Infinity" | "-Infinity" | "NaN");
            };
        };
        "Integration.CommandAttempt": {
            attemptID: components["schemas"]["Integration.AttemptID"];
            time: {
                created: number | ("Infinity" | "-Infinity" | "NaN");
                expires: number | ("Infinity" | "-Infinity" | "NaN");
            };
        };
        "Integration.CommandAttemptStatus": {
            /** @enum {string} */
            status: "pending";
            message?: string;
            time: {
                created: number | ("Infinity" | "-Infinity" | "NaN");
                expires: number | ("Infinity" | "-Infinity" | "NaN");
            };
        } | {
            /** @enum {string} */
            status: "complete";
            time: {
                created: number | ("Infinity" | "-Infinity" | "NaN");
                expires: number | ("Infinity" | "-Infinity" | "NaN");
            };
        } | {
            /** @enum {string} */
            status: "failed";
            message: string;
            time: {
                created: number | ("Infinity" | "-Infinity" | "NaN");
                expires: number | ("Infinity" | "-Infinity" | "NaN");
            };
        } | {
            /** @enum {string} */
            status: "expired";
            time: {
                created: number | ("Infinity" | "-Infinity" | "NaN");
                expires: number | ("Infinity" | "-Infinity" | "NaN");
            };
        };
        "Integration.CommandMethod": {
            id: components["schemas"]["Integration.MethodID"];
            /** @enum {string} */
            type: "command";
            label: string;
            command: string[];
        };
        "Integration.EnvMethod": {
            /** @enum {string} */
            type: "env";
            names: string[];
        };
        "Integration.ExternalMethod": {
            id: components["schemas"]["Integration.MethodID"];
            /** @enum {string} */
            type: "external";
            label: string;
            form?: components["schemas"]["Form.Fields"];
        };
        "Integration.ID": string;
        "Integration.Info": {
            id: components["schemas"]["Integration.ID"];
            name: string;
            metadata?: Record<string, never>;
            methods: components["schemas"]["Integration.Method"][];
            connections: components["schemas"]["Connection.Info"][];
        };
        "Integration.KeyMethod": {
            /** @enum {string} */
            type: "key";
            label?: string;
            form?: components["schemas"]["Form.Fields"];
        };
        "Integration.Method": components["schemas"]["Integration.OAuthMethod"] | components["schemas"]["Integration.CommandMethod"] | components["schemas"]["Integration.KeyMethod"] | components["schemas"]["Integration.ExternalMethod"] | components["schemas"]["Integration.EnvMethod"];
        "Integration.MethodID": string;
        "Integration.OAuthMethod": {
            id: components["schemas"]["Integration.MethodID"];
            /** @enum {string} */
            type: "oauth";
            label: string;
            form?: components["schemas"]["Form.Fields"];
        };
        IntegrationAttemptNotFoundErrorEncoded: {
            /** @enum {string} */
            _tag: "IntegrationAttemptNotFoundError";
            integrationID: string;
            attemptID: string;
            message: string;
        };
        IntegrationMethodNotFoundErrorEncoded: {
            /** @enum {string} */
            _tag: "IntegrationMethodNotFoundError";
            integrationID: string;
            methodID: string;
            message: string;
        };
        IntegrationNotFoundErrorEncoded: {
            /** @enum {string} */
            _tag: "IntegrationNotFoundError";
            integrationID: string;
            message: string;
        };
        InvalidCursorErrorEncoded: {
            /** @enum {string} */
            _tag: "InvalidCursorError";
            message: string;
        };
        InvalidRequestErrorEncoded: {
            /** @enum {string} */
            _tag: "InvalidRequestError";
            message: string;
            kind?: string | null;
            field?: string | null;
        };
        "Job.Image": {
            /** @enum {string} */
            kind: "image";
            id: string;
            sessionID: components["schemas"]["Session.ID"];
            status: components["schemas"]["Job.Status"];
            title?: string;
            time: components["schemas"]["Job.Time"];
            path: string;
            model: string;
        };
        "Job.Info": components["schemas"]["Job.Shell"] | components["schemas"]["Job.Subagent"] | components["schemas"]["Job.Image"];
        /** @enum {string} */
        "Job.Kind": "shell" | "subagent" | "image";
        "Job.Shell": {
            /** @enum {string} */
            kind: "shell";
            id: string;
            sessionID: components["schemas"]["Session.ID"];
            status: components["schemas"]["Job.Status"];
            title?: string;
            time: components["schemas"]["Job.Time"];
            shellID: string;
            command: string;
        };
        /** @enum {string} */
        "Job.Status": "running" | "completed" | "error" | "cancelled";
        "Job.Subagent": {
            /** @enum {string} */
            kind: "subagent";
            id: string;
            sessionID: components["schemas"]["Session.ID"];
            status: components["schemas"]["Job.Status"];
            title?: string;
            time: components["schemas"]["Job.Time"];
            childSessionID: components["schemas"]["Session.ID"];
            agent: string;
            description: string;
        };
        "Job.Time": {
            /** @description Start time in milliseconds since the Unix epoch */
            started: number;
            completed?: number;
        };
        "Location.PublicInfo": {
            directory: components["schemas"]["AbsolutePath"];
            project: {
                id: components["schemas"]["Project.ID"];
                directory: components["schemas"]["AbsolutePath"];
                canonical: components["schemas"]["AbsolutePath"];
            };
        };
        "Location.PublicRef": {
            directory: components["schemas"]["AbsolutePath"];
        };
        "Location.Ref": {
            directory: components["schemas"]["AbsolutePath"];
            workspaceID?: components["schemas"]["Workspace.ID"];
        };
        LocationNotFoundErrorEncoded: {
            /** @enum {string} */
            _tag: "LocationNotFoundError";
            location: components["schemas"]["Location.PublicRef"];
            message: string;
        };
        "Mcp.LocalConfigEncoded": {
            /** @enum {string} */
            type: "local";
            command: string[];
            cwd?: string;
            environment?: {
                [key: string]: string;
            };
            disabled?: boolean;
            codemode?: boolean;
            timeout?: {
                startup?: number;
                catalog?: number;
                execution?: number;
            };
            protocol?: components["schemas"]["Mcp.Protocol"];
            pool?: boolean;
        };
        "Mcp.OAuthConfigEncoded": {
            client_id?: string;
            client_secret?: string;
            scope?: string;
            callback_port?: number;
            redirect_uri?: string;
            auth_server_metadata_url?: string;
        };
        /**
         * @description MCP protocol negotiation. "legacy" (default) opens with the initialize handshake and speaks protocol revisions up to 2025-11-25. "auto" probes for the 2026-07-28 revision and falls back to legacy when the server does not support it. "2026-07-28" requires that revision and fails otherwise.
         * @enum {string}
         */
        "Mcp.Protocol": "legacy" | "auto" | "2026-07-28";
        "Mcp.RemoteConfigEncoded": {
            /** @enum {string} */
            type: "remote";
            url: string;
            headers?: {
                [key: string]: string;
            };
            oauth?: components["schemas"]["Mcp.OAuthConfigEncoded"] | false;
            disabled?: boolean;
            codemode?: boolean;
            timeout?: {
                startup?: number;
                catalog?: number;
                execution?: number;
            };
            protocol?: components["schemas"]["Mcp.Protocol"];
            pool?: boolean;
        };
        "Mcp.Resource": {
            server: string;
            name: string;
            uri: string;
            description?: string;
            mimeType?: string;
        };
        "Mcp.ResourceCatalog": {
            resources: components["schemas"]["Mcp.Resource"][];
            templates: components["schemas"]["Mcp.ResourceTemplate"][];
        };
        "Mcp.ResourceTemplate": {
            server: string;
            name: string;
            uriTemplate: string;
            description?: string;
            mimeType?: string;
        };
        "Mcp.Server": {
            name: string;
            status: components["schemas"]["Mcp.Status.Connected"] | components["schemas"]["Mcp.Status.Pending"] | components["schemas"]["Mcp.Status.Disabled"] | components["schemas"]["Mcp.Status.Failed"] | components["schemas"]["Mcp.Status.NeedsAuth"];
            title?: string;
            integrationID?: components["schemas"]["Integration.ID"];
        };
        "Mcp.Status.Connected": {
            /** @enum {string} */
            status: "connected";
        };
        "Mcp.Status.Disabled": {
            /** @enum {string} */
            status: "disabled";
        };
        "Mcp.Status.Failed": {
            /** @enum {string} */
            status: "failed";
            error: string;
        };
        "Mcp.Status.NeedsAuth": {
            /** @enum {string} */
            status: "needs_auth";
            error: string;
        };
        "Mcp.Status.Pending": {
            /** @enum {string} */
            status: "pending";
        };
        McpServerNotFoundErrorEncoded: {
            /** @enum {string} */
            _tag: "McpServerNotFoundError";
            server: string;
            message: string;
        };
        MediaHash: string;
        MessageNotFoundErrorEncoded: {
            /** @enum {string} */
            _tag: "MessageNotFoundError";
            sessionID: string;
            messageID: string;
            message: string;
        };
        /** @enum {string} */
        "Model.CacheFormat": "anthropic" | "alibaba";
        "Model.Capabilities": {
            tools: boolean;
            input: string[];
            output: string[];
            temperature?: boolean;
        };
        "Model.Compatibility": {
            reasoningField?: components["schemas"]["Model.ReasoningField"];
            requireReasoning?: boolean;
            maxTokensField?: components["schemas"]["Model.MaxTokensField"];
            requireFinishReason?: boolean;
            requireAssistantAfterTool?: boolean;
            supportsPromptCacheKey?: boolean;
            streamUsage?: boolean;
            cacheFormat?: components["schemas"]["Model.CacheFormat"];
            supportsThinkingBlockBinding?: boolean;
            supportsEffortUpdates?: boolean;
            mediaInput?: components["schemas"]["Model.MediaInput"];
        };
        "Model.Cost": {
            tier?: {
                /** @enum {string} */
                type: "context";
                size: number;
            };
            input: components["schemas"]["Money.USDPerMillionTokens"];
            output: components["schemas"]["Money.USDPerMillionTokens"];
            cache: {
                read: components["schemas"]["Money.USDPerMillionTokens"];
                write: components["schemas"]["Money.USDPerMillionTokens"];
            };
        };
        "Model.Info": {
            id: string;
            modelID: string;
            providerID: components["schemas"]["Provider.ID"];
            canonical?: components["schemas"]["Provider.ID"];
            type?: components["schemas"]["Model.Type"];
            family?: string;
            name: string;
            compatibility?: components["schemas"]["Model.Compatibility"];
            package?: string;
            settings?: components["schemas"]["Model.Settings"];
            headers?: {
                [key: string]: string;
            };
            body?: Record<string, never>;
            capabilities: components["schemas"]["Model.Capabilities"];
            variants: components["schemas"]["Model.Variant"][];
            time: {
                released: number;
            };
            cost: components["schemas"]["Model.Cost"][];
            /** @enum {string} */
            status: "alpha" | "beta" | "deprecated" | "active";
            enabled: boolean;
            limit: {
                context: number;
                input?: number;
                output: number;
            };
        };
        /** @enum {string} */
        "Model.MaxTokensField": "max_completion_tokens" | "max_tokens";
        /** @enum {string} */
        "Model.MediaInput": "assets" | "state" | "root";
        "Model.ReasoningField": ("reasoning" | "reasoning_content" | "reasoning_text") | string;
        "Model.Ref": {
            id: string;
            providerID: components["schemas"]["Provider.ID"];
            variant?: string;
        };
        "Model.Settings": {
            compaction?: components["schemas"]["Provider.Compaction"];
            cache?: components["schemas"]["Provider.Cache"];
            encoding?: components["schemas"]["Provider.Encoding"];
        } & {
            [key: string]: unknown;
        };
        "Model.Type": ("chat" | "decision" | "image") | string;
        "Model.Variant": {
            id: string;
            settings?: components["schemas"]["Model.VariantSettings"];
            headers?: {
                [key: string]: string;
            };
            body?: Record<string, never>;
        };
        "Model.VariantSettings": {
            compaction?: components["schemas"]["Provider.Compaction"];
            encoding?: components["schemas"]["Provider.Encoding"];
        } & {
            [key: string]: unknown;
        };
        ModelNotFoundErrorEncoded: {
            /** @enum {string} */
            _tag: "ModelNotFoundError";
            providerID: string;
            modelID: string;
            message: string;
        };
        "Money.USD": number;
        "Money.USDPerMillionTokens": number;
        PairingCode: {
            code: string;
            expires_in: number;
        };
        PairingSession: {
            token: string;
        };
        /** @enum {string} */
        "Permission.Effect": "allow" | "deny" | "ask";
        "Permission.ID": string;
        /** @enum {string} */
        "Permission.Reply": "once" | "always" | "reject";
        "Permission.Request": {
            id: components["schemas"]["Permission.ID"];
            sessionID: components["schemas"]["Session.ID"];
            action: string;
            resources: string[];
            save?: string[];
            metadata?: Record<string, never>;
            source?: components["schemas"]["Permission.Source"];
            message?: string;
        };
        "Permission.Rule": {
            action: string;
            resource: string;
            effect: components["schemas"]["Permission.Effect"];
        };
        "Permission.Ruleset": components["schemas"]["Permission.Rule"][];
        "Permission.Source": {
            /** @enum {string} */
            type: "tool";
            messageID: string;
            id: string;
        };
        PermissionNotFoundErrorEncoded: {
            /** @enum {string} */
            _tag: "PermissionNotFoundError";
            requestID: string;
            message: string;
        };
        "PermissionSaved.ID": string;
        "PermissionSaved.Info": {
            id: components["schemas"]["PermissionSaved.ID"];
            projectID: components["schemas"]["Project.ID"];
            action: string;
            resource: string;
            time: {
                created: number;
                updated: number;
            };
        };
        PermissionSavedNotFoundErrorEncoded: {
            /** @enum {string} */
            _tag: "PermissionSavedNotFoundError";
            id: string;
            message: string;
        };
        "PersistentPty.CreateInput": {
            command?: string;
            args: string[];
            cwd?: string;
            title: string;
            env: {
                [key: string]: string;
            };
            size?: {
                cols: number;
                rows: number;
            };
        };
        "PersistentPty.Handoff": {
            directory: string;
            instanceID: string;
            ticket: string;
            expiresAt: number | ("Infinity" | "-Infinity" | "NaN");
        };
        "PersistentPty.Info": {
            id: components["schemas"]["Pty.ID"];
            title: string;
            command: string;
            args: string[];
            cwd: string;
            /** @enum {string} */
            status: "running" | "exited";
            pid: number;
            exitCode?: number;
            sessionID: components["schemas"]["Session.ID"];
            userTitle: string | null;
            foregroundProcess: string | null;
            size: {
                cols: number;
                rows: number;
            };
            output: {
                head: number;
                tail: number;
            };
        };
        "PersistentPty.ReadResult": {
            ptyID: components["schemas"]["Pty.ID"];
            title: string;
            cwd: string;
            foregroundProcess: string | null;
            screen: {
                text: string;
                cols: number;
                rows: number;
                cursor: {
                    x: number;
                    y: number;
                };
            };
        };
        "PersistentPty.Snapshot": {
            info: components["schemas"]["PersistentPty.Info"];
            text: string;
            /** Format: byte */
            checkpoint: string;
            cursor: {
                x: number;
                y: number;
            };
        };
        "PersistentPty.UpdateInput": {
            attachmentID?: string;
            size?: {
                cols: number;
                rows: number;
            };
            title?: string | null;
        };
        "Plugin.Features": {
            /** @enum {boolean} */
            server?: true;
            /** @enum {boolean} */
            tui?: true;
            /** @enum {boolean} */
            rpc?: true;
            /** @enum {boolean} */
            gui?: true;
        };
        "Plugin.GuiBundle": {
            code: string;
            revision: string;
            options: Record<string, never>;
        };
        "Plugin.ID": string;
        "Plugin.Info": {
            id?: components["schemas"]["Plugin.ID"];
            source: components["schemas"]["Plugin.Source"];
            features: components["schemas"]["Plugin.Features"];
            state: components["schemas"]["Plugin.State"];
        };
        "Plugin.Source": {
            /** @enum {string} */
            type: "builtin";
        } | {
            /** @enum {string} */
            type: "package";
            target: string;
            version?: string;
            /** @enum {boolean} */
            outdated?: true;
            /** @enum {boolean} */
            updating?: true;
        } | {
            /** @enum {string} */
            type: "local";
            path: string;
        } | {
            /** @enum {string} */
            type: "sdk";
        };
        "Plugin.State": {
            /** @enum {string} */
            status: "active";
        } | {
            /** @enum {string} */
            status: "failed";
            error: string;
            ref?: string;
        };
        PluginNotFoundErrorEncoded: {
            /** @enum {string} */
            _tag: "PluginNotFoundError";
            pluginID: string;
            message: string;
        };
        Project: {
            id: components["schemas"]["Project.ID"];
            canonical: components["schemas"]["AbsolutePath"];
            vcs?: components["schemas"]["Project.Vcs"];
            name?: string;
            icon?: components["schemas"]["Project.Icon"];
            commands?: components["schemas"]["Project.Commands"];
            time: components["schemas"]["Project.Time"];
            sandboxes: string[];
        };
        "Project.Commands": {
            /** @description Startup script to run when creating a new workspace (worktree) */
            start?: string;
        };
        "Project.ID": string;
        "Project.Icon": {
            url?: string;
            override?: string;
            color?: string;
        };
        "Project.Time": {
            created: number;
            updated: number;
            active: number;
            archived?: number;
        };
        "Project.Vcs": string;
        ProjectNotFoundErrorEncoded: {
            /** @enum {string} */
            _tag: "ProjectNotFoundError";
            projectID: string;
            message: string;
        };
        "Prompt.AgentAttachment": {
            name: string;
            mention?: components["schemas"]["Prompt.Mention"];
        };
        "Prompt.Base64": string;
        "Prompt.FileAttachment": {
            data: components["schemas"]["Prompt.Base64"];
            mime: string;
            source: components["schemas"]["Prompt.FileSource"];
            name?: string;
            description?: string;
            mention?: components["schemas"]["Prompt.Mention"];
        };
        "Prompt.FileSource": {
            /** @enum {string} */
            type: "inline";
        } | {
            /** @enum {string} */
            type: "uri";
            uri: string;
        };
        "Prompt.Mention": {
            start: number;
            end: number;
            text: string;
        };
        "Prompt.SkillAttachment": {
            id: components["schemas"]["Skill.ID"];
            name: components["schemas"]["Skill.Name"];
            text?: string;
            mention?: components["schemas"]["Prompt.Mention"];
        };
        "PromptInput.FileAttachment": {
            uri: string;
            source?: components["schemas"]["Prompt.FileSource"];
            name?: string;
            description?: string;
            mention?: components["schemas"]["Prompt.Mention"];
        };
        "PromptInput.SkillAttachment": {
            id: components["schemas"]["Skill.ID"];
            mention?: components["schemas"]["Prompt.Mention"];
        };
        "Provider.Cache": {
            ttl?: components["schemas"]["Provider.CacheTTL"];
            warming?: components["schemas"]["Provider.CacheWarming"];
        };
        "Provider.CacheTTL": string;
        "Provider.CacheWarming": boolean | {
            interval?: "auto" | string;
            duration?: string;
        };
        "Provider.Compaction": {
            /** @enum {string} */
            type: "summary";
        } | {
            /** @enum {string} */
            type: "native";
        };
        "Provider.Compatibility": {
            reasoningField?: components["schemas"]["Model.ReasoningField"];
            requireReasoning?: boolean;
            maxTokensField?: components["schemas"]["Model.MaxTokensField"];
            requireFinishReason?: boolean;
            requireAssistantAfterTool?: boolean;
            supportsPromptCacheKey?: boolean;
            streamUsage?: boolean;
            cacheFormat?: components["schemas"]["Model.CacheFormat"];
            mediaInput?: components["schemas"]["Model.MediaInput"];
        };
        /** @enum {string} */
        "Provider.Encoding": "zstd" | "gzip" | "none";
        "Provider.ID": string;
        "Provider.Info": {
            id: components["schemas"]["Provider.ID"];
            canonical?: components["schemas"]["Provider.ID"];
            integrationID?: components["schemas"]["Integration.ID"];
            name: string;
            /** @enum {string} */
            activation: "auto" | "enabled" | "disabled";
            package: string;
            compatibility?: components["schemas"]["Provider.Compatibility"];
            settings?: components["schemas"]["Provider.Settings"];
            headers?: {
                [key: string]: string;
            };
            body?: Record<string, never>;
        };
        "Provider.Request": {
            settings: components["schemas"]["Provider.Settings"];
            headers: {
                [key: string]: string;
            };
            body: Record<string, never>;
        };
        "Provider.Settings": {
            timeout?: number | false;
            headerTimeout?: number | false;
            chunkTimeout?: number | false;
            compaction?: components["schemas"]["Provider.Compaction"];
            cache?: components["schemas"]["Provider.Cache"];
            transport?: components["schemas"]["Provider.Transport"];
            encoding?: components["schemas"]["Provider.Encoding"];
        } & {
            [key: string]: unknown;
        };
        /** @enum {string} */
        "Provider.Transport": "http" | "websocket";
        ProviderNotFoundErrorEncoded: {
            /** @enum {string} */
            _tag: "ProviderNotFoundError";
            providerID: string;
            message: string;
        };
        ProviderRequestErrorEncoded: {
            /** @enum {string} */
            _tag: "ProviderRequestError";
            providerID: string;
            /** @enum {string} */
            reason: "authentication" | "rate_limit" | "content_filter" | "invalid_request" | "overloaded" | "provider";
            message: string;
            status?: number | null;
            retryAfterMs?: number | null;
        };
        Pty: {
            id: components["schemas"]["Pty.ID"];
            title: string;
            command: string;
            args: string[];
            cwd: string;
            /** @enum {string} */
            status: "running" | "exited";
            pid: number;
            exitCode?: number;
        };
        "Pty.ID": string;
        PtyFeatureUnsupportedErrorEncoded: {
            /** @enum {string} */
            _tag: "PtyFeatureUnsupportedError";
            feature: string;
            message: string;
        };
        PtyNotFoundErrorEncoded: {
            /** @enum {string} */
            _tag: "PtyNotFoundError";
            ptyID: string;
            message: string;
        };
        "PtyTicket.ConnectToken": {
            ticket: string;
            expires_in: number;
        };
        "Reference.GitSource": {
            /** @enum {string} */
            type: "git";
            repository: string;
            branch?: string;
        };
        "Reference.Info": {
            name: string;
            path: components["schemas"]["AbsolutePath"];
            description?: string;
            hidden?: boolean;
            source: components["schemas"]["Reference.Source"];
        };
        "Reference.LocalSource": {
            /** @enum {string} */
            type: "local";
            path: components["schemas"]["AbsolutePath"];
        };
        "Reference.Source": components["schemas"]["Reference.LocalSource"] | components["schemas"]["Reference.GitSource"];
        RelativePath: string;
        "Rpc.Input": {
            input?: unknown;
        };
        "Rpc.Output": {
            output?: unknown;
        };
        RpcErrorEncoded: {
            /** @enum {string} */
            _tag: "RpcError";
            type: string;
            message: string;
            data?: unknown | null;
        };
        RpcInternalErrorEncoded: {
            /** @enum {string} */
            _tag: "RpcInternalError";
            /** @enum {string} */
            type: "rpc.internal" | "rpc.invalid_output";
            message: string;
            data?: unknown | null;
        };
        "Schedule.Action": components["schemas"]["Schedule.Action.Prompt"];
        "Schedule.Action.Prompt": {
            /** @enum {string} */
            type: "prompt";
            prompt: string;
        };
        "Schedule.Condition": components["schemas"]["Schedule.Condition.Shell"] | components["schemas"]["Schedule.Condition.Code"];
        "Schedule.Condition.Code": {
            /** @enum {string} */
            type: "code";
            code: string;
        };
        "Schedule.Condition.Shell": {
            /** @enum {string} */
            type: "shell";
            run: string;
            is?: string;
            matches?: string;
            changes?: boolean;
        };
        "Schedule.ConditionInput": {
            /** @description Shell command to run in the Session's directory. Alone, exit 0 wakes and stdout is appended. */
            run: string;
            is?: string;
            matches?: string;
            changes?: boolean;
            code?: unknown;
        } | {
            /** @description Code Mode JavaScript check (no fetch; 30s, 20 tool calls, 32 KB output cap). Call tools statically as tools.<ns>.<tool>(...) or tools["ns-name"].tool(...); each is authorized once at creation to run unattended. Runs once at creation with state = null (if baselines state without waking; until matches immediately if true), with globals state, now (epoch ms) and runs. Return a boolean or { wake, state?, message? } (message is appended to prompt on wake), e.g.: const t = await tools.slack.read_thread({ id }); return { wake: state !== null && t.count > state.count, state: { count: t.count }, message: "New reply" } */
            code: string;
            run?: unknown;
            is?: unknown;
            matches?: unknown;
            changes?: unknown;
        };
        "Schedule.CreatePayload": {
            sessionID: components["schemas"]["Session.ID"];
            name?: string;
            when?: components["schemas"]["Schedule.WhenInput"];
            if?: components["schemas"]["Schedule.ConditionInput"];
            until?: components["schemas"]["Schedule.ConditionInput"];
            ends?: components["schemas"]["Schedule.Ends"];
            /** @description The message the Session receives when the schedule wakes. */
            prompt: string;
        };
        /** @description A duration such as "90 seconds", "5 minutes" or "2 hours". */
        "Schedule.Duration": string;
        "Schedule.Ends": {
            after?: components["schemas"]["Schedule.Duration"];
            at?: string;
            times?: number;
        };
        "Schedule.ID": string;
        "Schedule.Info": {
            id: components["schemas"]["Schedule.ID"];
            sessionID?: components["schemas"]["Session.ID"];
            name?: string;
            when: components["schemas"]["Schedule.When"];
            tz: string;
            if?: components["schemas"]["Schedule.Condition"];
            until?: components["schemas"]["Schedule.Condition"];
            action: components["schemas"]["Schedule.Action"];
            status: components["schemas"]["Schedule.Status"];
            nextDueAt?: number;
            endsAt?: number;
            remainingRuns?: number;
            runCount: number;
            lastFiredAt?: number;
            lastOutcome?: components["schemas"]["Schedule.Outcome"];
            lastOutput?: string;
            time: {
                created: number;
                updated: number;
            };
        };
        /** @enum {string} */
        "Schedule.Outcome": "fired" | "late" | "checked" | "expired" | "skipped" | "disabled" | "failed";
        /** @enum {string} */
        "Schedule.Status": "active" | "paused" | "done";
        "Schedule.When": components["schemas"]["Schedule.When.In"] | components["schemas"]["Schedule.When.At"] | components["schemas"]["Schedule.When.Every"] | components["schemas"]["Schedule.When.Cron"];
        "Schedule.When.At": {
            /** @enum {string} */
            type: "at";
            at: string;
            tz?: string;
        };
        "Schedule.When.Cron": {
            /** @enum {string} */
            type: "cron";
            cron: string;
            tz?: string;
        };
        "Schedule.When.Every": {
            /** @enum {string} */
            type: "every";
            every: components["schemas"]["Schedule.Duration"];
            tz?: string;
        };
        "Schedule.When.In": {
            /** @enum {string} */
            type: "in";
            in: components["schemas"]["Schedule.Duration"];
            tz?: string;
        };
        "Schedule.WhenInput": {
            in: components["schemas"]["Schedule.Duration"];
            at?: unknown;
            every?: unknown;
            cron?: unknown;
            tz?: string;
        } | {
            at: string;
            in?: unknown;
            every?: unknown;
            cron?: unknown;
            tz?: string;
        } | {
            every: components["schemas"]["Schedule.Duration"];
            in?: unknown;
            at?: unknown;
            cron?: unknown;
            tz?: string;
        } | {
            cron: string;
            in?: unknown;
            at?: unknown;
            every?: unknown;
            tz?: string;
        };
        ScheduleNotFoundErrorEncoded: {
            /** @enum {string} */
            _tag: "ScheduleNotFoundError";
            scheduleID: string;
            message: string;
        };
        ServerInfo: {
            version: string;
            pid: number;
            hostname?: string | null;
            urls: string[];
            paths: {
                tmp: string;
            };
            capabilities?: {
                persistentPty?: boolean | null;
            } | null;
        };
        ServiceUnavailableErrorEncoded: {
            /** @enum {string} */
            _tag: "ServiceUnavailableError";
            message: string;
            service?: string | null;
        };
        "Session.Event.Durable": components["schemas"]["session.created"] | components["schemas"]["session.agent.selected"] | components["schemas"]["session.model.selected"] | components["schemas"]["session.moved"] | components["schemas"]["session.renamed"] | components["schemas"]["session.metadata.updated"] | components["schemas"]["session.permissions"] | components["schemas"]["session.viewed"] | components["schemas"]["session.archived"] | components["schemas"]["session.unarchived"] | components["schemas"]["session.deleted"] | components["schemas"]["session.forked"] | components["schemas"]["session.inbox.delivered"] | components["schemas"]["session.inbox.enqueued"] | components["schemas"]["session.inbox.cancelled"] | components["schemas"]["session.inbox.delivery.changed"] | components["schemas"]["session.execution.started"] | components["schemas"]["session.execution.succeeded"] | components["schemas"]["session.execution.failed"] | components["schemas"]["session.execution.interrupted"] | components["schemas"]["session.instructions.updated"] | components["schemas"]["session.synthetic"] | components["schemas"]["session.skill.activated"] | components["schemas"]["session.shell.started"] | components["schemas"]["session.shell.ended"] | components["schemas"]["session.step.started"] | components["schemas"]["session.step.streamed"] | components["schemas"]["session.step.ended"] | components["schemas"]["session.step.failed"] | components["schemas"]["session.text.started"] | components["schemas"]["session.text.ended"] | components["schemas"]["session.reasoning.started"] | components["schemas"]["session.reasoning.ended"] | components["schemas"]["session.tool.input.started"] | components["schemas"]["session.tool.input.ended"] | components["schemas"]["session.tool.called"] | components["schemas"]["session.tool.success"] | components["schemas"]["session.tool.failed"] | components["schemas"]["session.retry.scheduled"] | components["schemas"]["session.compaction.started"] | components["schemas"]["session.compaction.ended"] | components["schemas"]["session.compaction.failed"] | components["schemas"]["session.revert.staged"] | components["schemas"]["session.revert.cleared"] | components["schemas"]["session.revert.committed"] | components["schemas"]["session.usage.recorded"] | components["schemas"]["session.message.content.updated"];
        "Session.ForkBoundary": {
            /** @enum {string} */
            type: "before";
            messageID: components["schemas"]["Session.Message.ID"];
        } | {
            /** @enum {string} */
            type: "through";
            messageID: components["schemas"]["Session.Message.ID"];
        };
        "Session.ID": string;
        "Session.Inbox.Compaction": {
            id: components["schemas"]["Session.Message.ID"];
            sessionID: components["schemas"]["Session.ID"];
            time: {
                created: number;
            };
            /** @enum {string} */
            type: "compaction";
            payload: components["schemas"]["Session.Inbox.CompactionPayload"];
            delivery: components["schemas"]["Session.Inbox.Delivery"];
        };
        "Session.Inbox.CompactionPayload": unknown;
        /** @enum {string} */
        "Session.Inbox.Delivery": "steer" | "queue";
        "Session.Inbox.Info": components["schemas"]["Session.Inbox.User"] | components["schemas"]["Session.Inbox.Synthetic"] | components["schemas"]["Session.Inbox.Compaction"] | components["schemas"]["Session.Inbox.Move"];
        "Session.Inbox.Item": {
            /** @enum {string} */
            type: "user";
            payload: components["schemas"]["Session.Inbox.UserPayload"];
            delivery: components["schemas"]["Session.Inbox.Delivery"];
        } | {
            /** @enum {string} */
            type: "synthetic";
            payload: components["schemas"]["Session.Inbox.SyntheticPayload"];
            delivery: components["schemas"]["Session.Inbox.Delivery"];
        } | {
            /** @enum {string} */
            type: "compaction";
            payload: components["schemas"]["Session.Inbox.CompactionPayload"];
            delivery: components["schemas"]["Session.Inbox.Delivery"];
        } | {
            /** @enum {string} */
            type: "move";
            payload: components["schemas"]["Session.Inbox.MovePayload_1"];
            delivery: components["schemas"]["Session.Inbox.Delivery"];
        };
        "Session.Inbox.Move": {
            id: components["schemas"]["Session.Message.ID"];
            sessionID: components["schemas"]["Session.ID"];
            time: {
                created: number;
            };
            /** @enum {string} */
            type: "move";
            delivery: components["schemas"]["Session.Inbox.Delivery"];
            payload: components["schemas"]["Session.Inbox.MovePayload"];
        };
        "Session.Inbox.MovePayload": {
            projectID: components["schemas"]["Project.ID"];
            subpath?: components["schemas"]["RelativePath"];
            location: components["schemas"]["Location.PublicRef"];
        };
        "Session.Inbox.MovePayload_1": {
            location: components["schemas"]["Location.Ref"];
            projectID: components["schemas"]["Project.ID"];
            subpath?: components["schemas"]["RelativePath"];
        };
        "Session.Inbox.Synthetic": {
            id: components["schemas"]["Session.Message.ID"];
            sessionID: components["schemas"]["Session.ID"];
            time: {
                created: number;
            };
            /** @enum {string} */
            type: "synthetic";
            payload: components["schemas"]["Session.Inbox.SyntheticPayload"];
            delivery: components["schemas"]["Session.Inbox.Delivery"];
        };
        "Session.Inbox.SyntheticPayload": {
            text: string;
            description?: string;
            metadata?: Record<string, never>;
        };
        "Session.Inbox.User": {
            id: components["schemas"]["Session.Message.ID"];
            sessionID: components["schemas"]["Session.ID"];
            time: {
                created: number;
            };
            /** @enum {string} */
            type: "user";
            payload: components["schemas"]["Session.Inbox.UserPayload"];
            delivery: components["schemas"]["Session.Inbox.Delivery"];
        };
        "Session.Inbox.UserPayload": {
            text: string;
            files?: components["schemas"]["Prompt.FileAttachment"][];
            agents?: components["schemas"]["Prompt.AgentAttachment"][];
            skills?: components["schemas"]["Prompt.SkillAttachment"][];
            metadata?: Record<string, never>;
        };
        "Session.Info": {
            id: components["schemas"]["Session.ID"];
            parentID?: components["schemas"]["Session.ID"];
            fork?: {
                sessionID: components["schemas"]["Session.ID"];
                boundary: components["schemas"]["Session.ForkBoundary"];
            };
            projectID: components["schemas"]["Project.ID"];
            agent?: components["schemas"]["Agent.ID"];
            model?: components["schemas"]["Model.Ref"];
            cost: components["schemas"]["Money.USD"];
            tokens: components["schemas"]["TokenUsage.Info"];
            /** @enum {string} */
            outcome?: "succeeded" | "failed" | "interrupted";
            time: {
                created: number;
                updated: number;
                busy?: number;
                idle?: number;
                viewed?: number;
                archived?: number;
            };
            title?: string;
            subpath?: components["schemas"]["RelativePath"];
            metadata?: components["schemas"]["Session.Metadata"];
            permissions?: components["schemas"]["Permission.Ruleset"];
            revert?: components["schemas"]["Session.Revert"];
            location: components["schemas"]["Location.PublicRef"];
        };
        "Session.Message.AgentSelected": {
            id: components["schemas"]["Session.Message.ID"];
            metadata?: Record<string, never>;
            time: {
                created: number;
            };
            /** @enum {string} */
            type: "agent-switched";
            agent: components["schemas"]["Agent.ID"];
            previous?: components["schemas"]["Agent.ID"];
        };
        "Session.Message.Assistant": {
            id: components["schemas"]["Session.Message.ID"];
            metadata?: Record<string, never>;
            time: {
                created: number;
                streamed?: number;
                completed?: number;
            };
            /** @enum {string} */
            type: "assistant";
            agent: components["schemas"]["Agent.ID"];
            model: components["schemas"]["Model.Ref"];
            content: (components["schemas"]["Session.Message.Assistant.Text"] | components["schemas"]["Session.Message.Assistant.Reasoning"] | components["schemas"]["Session.Message.Assistant.Tool"])[];
            snapshot?: {
                start?: components["schemas"]["Snapshot.ID"];
                end?: components["schemas"]["Snapshot.ID"];
                files?: components["schemas"]["RelativePath"][];
            };
            /** @enum {string} */
            finish?: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown";
            rawFinish?: string;
            native?: components["schemas"]["Session.Message.Native"];
            cost?: components["schemas"]["Money.USD"];
            tokens?: components["schemas"]["TokenUsage.Info"];
            error?: components["schemas"]["Session.StructuredError"];
            retry?: components["schemas"]["Session.Message.Assistant.Retry"];
        };
        "Session.Message.Assistant.Reasoning": {
            /** @enum {string} */
            type: "reasoning";
            text: string;
            native?: components["schemas"]["Session.Message.Native"];
            time?: {
                created: number;
                completed?: number;
            };
        };
        "Session.Message.Assistant.Retry": {
            attempt: number;
            at: number;
            error: components["schemas"]["Session.StructuredError"];
        };
        "Session.Message.Assistant.Text": {
            /** @enum {string} */
            type: "text";
            text: string;
            native?: components["schemas"]["Session.Message.Native"];
        };
        "Session.Message.Assistant.Tool": {
            /** @enum {string} */
            type: "tool";
            id: string;
            name: string;
            executed?: boolean;
            native?: components["schemas"]["Session.Message.Native"];
            state: components["schemas"]["Session.Message.ToolState.Streaming"] | components["schemas"]["Session.Message.ToolState.Running"] | components["schemas"]["Session.Message.ToolState.Completed"] | components["schemas"]["Session.Message.ToolState.Error"];
            time: {
                created: number;
                ran?: number;
                completed?: number;
            };
        };
        "Session.Message.AssistantContent.Encoded": components["schemas"]["Session.Message.Assistant.Text"] | components["schemas"]["Session.Message.Assistant.Reasoning"] | components["schemas"]["Session.Message.Assistant.Tool"];
        "Session.Message.Compaction": components["schemas"]["Session.Message.Compaction.Running"] | components["schemas"]["Session.Message.Compaction.Completed"] | components["schemas"]["Session.Message.Compaction.Failed"];
        "Session.Message.Compaction.Completed": {
            /** @enum {string} */
            type: "compaction";
            id: components["schemas"]["Session.Message.ID"];
            metadata?: Record<string, never>;
            time: {
                created: number;
            };
            /** @enum {string} */
            status: "completed";
            /** @enum {string} */
            reason: "auto" | "manual";
            model?: components["schemas"]["Model.Ref"];
            native?: components["schemas"]["Session.Message.Native"];
            summary: string;
            cost?: components["schemas"]["Money.USD"];
            tokens?: components["schemas"]["TokenUsage.Info"];
        };
        "Session.Message.Compaction.Failed": {
            /** @enum {string} */
            type: "compaction";
            id: components["schemas"]["Session.Message.ID"];
            metadata?: Record<string, never>;
            time: {
                created: number;
            };
            /** @enum {string} */
            status: "failed";
            /** @enum {string} */
            reason: "auto" | "manual";
            error: components["schemas"]["Session.StructuredError"];
            cost?: components["schemas"]["Money.USD"];
            tokens?: components["schemas"]["TokenUsage.Info"];
        };
        "Session.Message.Compaction.Running": {
            /** @enum {string} */
            type: "compaction";
            id: components["schemas"]["Session.Message.ID"];
            metadata?: Record<string, never>;
            time: {
                created: number;
            };
            /** @enum {string} */
            status: "running";
            /** @enum {string} */
            reason: "auto" | "manual";
            summary: string;
        };
        "Session.Message.ID": string;
        "Session.Message.Idle": {
            id: components["schemas"]["Session.Message.ID"];
            metadata?: Record<string, never>;
            time: {
                created: number;
            };
            /** @enum {string} */
            type: "idle";
            /** @enum {string} */
            outcome: "succeeded" | "failed" | "interrupted";
            error?: components["schemas"]["Session.StructuredError"];
        };
        "Session.Message.Info": components["schemas"]["Session.Message.AgentSelected"] | components["schemas"]["Session.Message.ModelSelected"] | components["schemas"]["Session.Message.LocationSwitched"] | components["schemas"]["Session.Message.User"] | components["schemas"]["Session.Message.Synthetic"] | components["schemas"]["Session.Message.System"] | components["schemas"]["Session.Message.Skill"] | components["schemas"]["Session.Message.Shell"] | components["schemas"]["Session.Message.Assistant"] | components["schemas"]["Session.Message.Compaction"] | components["schemas"]["Session.Message.Idle"];
        "Session.Message.LocationSwitched": {
            id: components["schemas"]["Session.Message.ID"];
            metadata?: Record<string, never>;
            time: {
                created: number;
            };
            /** @enum {string} */
            type: "location-switched";
            projectID?: components["schemas"]["Project.ID"];
            subpath?: components["schemas"]["RelativePath"];
            location: components["schemas"]["Location.PublicRef"];
            previous?: {
                location: components["schemas"]["Location.PublicRef"];
                projectID?: components["schemas"]["Project.ID"];
                subpath?: components["schemas"]["RelativePath"];
            } | null;
        };
        "Session.Message.ModelSelected": {
            id: components["schemas"]["Session.Message.ID"];
            metadata?: Record<string, never>;
            time: {
                created: number;
            };
            /** @enum {string} */
            type: "model-switched";
            model: components["schemas"]["Model.Ref"];
            previous?: components["schemas"]["Model.Ref"];
        };
        "Session.Message.Native": Record<string, never>;
        "Session.Message.Shell": {
            id: components["schemas"]["Session.Message.ID"];
            metadata?: Record<string, never>;
            time: {
                created: number;
                completed?: number;
            };
            /** @enum {string} */
            type: "shell";
            shellID: components["schemas"]["Shell.ID"];
            command: string;
            /** @enum {string} */
            status: "running" | "exited" | "timeout" | "killed";
            exit?: number | ("Infinity" | "-Infinity" | "NaN");
            output?: {
                output: string;
                cursor: number;
                size: number;
                truncated: boolean;
            };
        };
        "Session.Message.Skill": {
            id: components["schemas"]["Session.Message.ID"];
            metadata?: Record<string, never>;
            time: {
                created: number;
            };
            /** @enum {string} */
            type: "skill";
            skill: components["schemas"]["Skill.ID"];
            name: components["schemas"]["Skill.Name"];
            text: string;
        };
        "Session.Message.Synthetic": {
            id: components["schemas"]["Session.Message.ID"];
            metadata?: Record<string, never>;
            time: {
                created: number;
            };
            text: string;
            description?: string;
            /** @enum {string} */
            type: "synthetic";
        };
        "Session.Message.System": {
            id: components["schemas"]["Session.Message.ID"];
            metadata?: Record<string, never>;
            time: {
                created: number;
            };
            /** @enum {string} */
            type: "system";
            text: string;
            description?: string;
        };
        "Session.Message.ToolState.Completed": {
            /** @enum {string} */
            status: "completed";
            input: Record<string, never>;
            content: [
                components["schemas"]["Tool.Content"]
            ];
            metadata?: Record<string, never>;
        };
        "Session.Message.ToolState.Error": {
            /** @enum {string} */
            status: "error";
            input: Record<string, never>;
            error: components["schemas"]["Session.StructuredError"];
            content?: [
                components["schemas"]["Tool.Content"]
            ];
            metadata?: Record<string, never>;
        };
        "Session.Message.ToolState.Running": {
            /** @enum {string} */
            status: "running";
            input: Record<string, never>;
            metadata: Record<string, never>;
        };
        "Session.Message.ToolState.Streaming": {
            /** @enum {string} */
            status: "streaming";
            input: string;
        };
        "Session.Message.User": {
            id: components["schemas"]["Session.Message.ID"];
            metadata?: Record<string, never>;
            time: {
                created: number;
            };
            text: string;
            files?: components["schemas"]["Prompt.FileAttachment"][];
            agents?: components["schemas"]["Prompt.AgentAttachment"][];
            skills?: components["schemas"]["Prompt.SkillAttachment"][];
            /** @enum {string} */
            type: "user";
        };
        "Session.Metadata": Record<string, never>;
        "Session.Revert": {
            messageID: components["schemas"]["Session.Message.ID"];
            partID?: string;
            snapshot?: components["schemas"]["Snapshot.ID"];
            files?: components["schemas"]["FileDiff.Info"][];
        };
        "Session.StructuredError": {
            type: string;
            message: string;
            status?: number;
            response?: {
                body: string;
            };
            retryAfterMs?: number;
        };
        SessionActive: {
            /** @enum {string} */
            type: "running";
        };
        SessionBusyErrorEncoded: {
            /** @enum {string} */
            _tag: "SessionBusyError";
            sessionID: string;
            message: string;
        };
        SessionGenerateResponse: {
            data: {
                text: string;
            };
        };
        SessionInterruptResponse: {
            /** @description Whether an active execution owned by this OpenCode process was interrupted. */
            interrupted: boolean;
        };
        SessionLogItem: components["schemas"]["Session.Event.Durable"] | components["schemas"]["EventLog.Synced"];
        SessionLogItemEncoded: string;
        SessionMessagesResponse: {
            data: components["schemas"]["Session.Message.Info"][];
            cursor: {
                previous?: string | null;
                next?: string | null;
            };
        };
        SessionNotFoundErrorEncoded: {
            /** @enum {string} */
            _tag: "SessionNotFoundError";
            sessionID: string;
            message: string;
        };
        "SessionStats.Activity": {
            date: string;
            steps: number;
        };
        "SessionStats.Info": {
            range: {
                from: number;
                to: number;
            };
            sessions: number;
            subagents: number;
            prompts: number;
            steps: number;
            tokens: components["schemas"]["TokenUsage.Info"];
            cost: components["schemas"]["Money.USD"];
            tools: components["schemas"]["SessionStats.Tools"];
            activeDays: number;
            streak: number;
            activity: components["schemas"]["SessionStats.Activity"][];
            models: components["schemas"]["SessionStats.ModelUsage"][];
        };
        "SessionStats.ModelUsage": {
            model: components["schemas"]["Model.Ref"];
            steps: number;
            tokens: components["schemas"]["TokenUsage.Info"];
            cost: components["schemas"]["Money.USD"];
        };
        "SessionStats.ToolTotals": {
            calls: number;
            succeeded: number;
            failed: number;
            unfinished: number;
        };
        "SessionStats.ToolUsage": {
            name: string;
            calls: number;
            succeeded: number;
            failed: number;
            unfinished: number;
            durationP50?: number;
        };
        "SessionStats.Tools": {
            /** @enum {string} */
            mode: "none";
        } | {
            /** @enum {string} */
            mode: "summary";
            totals: components["schemas"]["SessionStats.ToolTotals"];
        } | {
            /** @enum {string} */
            mode: "detail";
            totals: components["schemas"]["SessionStats.ToolTotals"];
            usage: components["schemas"]["SessionStats.ToolUsage"][];
        };
        SessionStatus: {
            /** @enum {string} */
            type: "idle";
        } | {
            /** @enum {string} */
            type: "retry";
            attempt: number;
            message: string;
            action?: {
                reason: string;
                provider: string;
                title: string;
                message: string;
                label: string;
                link?: string;
            };
            next: number;
        } | {
            /** @enum {string} */
            type: "busy";
        };
        SessionStatusUpdated: {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.status";
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                status: components["schemas"]["SessionStatus"];
            };
        };
        "SessionTransfer.Data": {
            info: components["schemas"]["Session.Info"];
            messages: components["schemas"]["Session.Message.Info"][];
        };
        /** @description Opaque pagination cursor returned as cursor.previous or cursor.next in the previous response. */
        SessionsCursor: string;
        SessionsResponse: {
            data: components["schemas"]["Session.Info"][];
            cursor: {
                previous?: components["schemas"]["SessionsCursor"] | null;
                next?: components["schemas"]["SessionsCursor"] | null;
            };
        };
        "Shell.ID": string;
        "Shell.Info": {
            id: components["schemas"]["Shell.ID"];
            /** @enum {string} */
            status: "running" | "exited" | "timeout" | "killed";
            command: string;
            cwd: string;
            shell: string;
            file: string;
            pid?: number;
            exit?: number;
            signal?: string;
            metadata: Record<string, never>;
            time: {
                /** @description Start time in milliseconds since the Unix epoch */
                started: number;
                completed?: number;
            };
        };
        ShellNotFoundErrorEncoded: {
            /** @enum {string} */
            _tag: "ShellNotFoundError";
            id: string;
            message: string;
        };
        "Skill.ID": string;
        "Skill.Info": {
            id: components["schemas"]["Skill.ID"];
            name: components["schemas"]["Skill.Name"];
            description?: string;
            autoinvoke?: boolean;
            path: components["schemas"]["AbsolutePath"];
            content: string;
        };
        "Skill.Name": string;
        SkillNotFoundErrorEncoded: {
            /** @enum {string} */
            _tag: "SkillNotFoundError";
            skill: components["schemas"]["Skill.ID"];
            message: string;
        };
        "Snapshot.ID": string;
        "TokenUsage.Info": {
            input: number;
            output: number;
            reasoning: number;
            cache: {
                read: number;
                write: number;
            };
        };
        "Tool.Content": components["schemas"]["Tool.TextContent"] | components["schemas"]["Tool.FileContent"];
        "Tool.FileContent": {
            /** @enum {string} */
            type: "file";
            uri: string;
            mime: string;
            name?: string | null;
        };
        "Tool.TextContent": {
            /** @enum {string} */
            type: "text";
            text: string;
        };
        UnauthorizedErrorEncoded: {
            /** @enum {string} */
            _tag: "UnauthorizedError";
            message: string;
        };
        UnknownErrorEncoded: {
            /** @enum {string} */
            _tag: "UnknownError";
            message: string;
            ref?: string | null;
        };
        UnsupportedModelErrorEncoded: {
            /** @enum {string} */
            _tag: "UnsupportedModelError";
            providerID: string;
            modelID: string;
            capability: string;
            message: string;
        };
        "UsageLimits.Budget": {
            id: string;
            limit: components["schemas"]["Money.USD"];
            spent: components["schemas"]["Money.USD"];
            /** @enum {string} */
            scope: "each" | "combined";
            /** @enum {string} */
            per: "set" | "model";
            /** @enum {string} */
            coverage: "all" | "models";
            models: components["schemas"]["UsageLimits.BudgetModel"][];
            vendors: string[];
            inputPriceAtLeast?: components["schemas"]["Money.USDPerMillionTokens"];
            picked: boolean;
            shared: boolean;
            /** @description Milliseconds since the Unix epoch */
            resetsAt: number;
        };
        "UsageLimits.BudgetModel": {
            providerID: components["schemas"]["Provider.ID"];
            modelID: string;
            name: string;
            spent?: components["schemas"]["Money.USD"];
        };
        "UsageLimits.Go": {
            rolling: components["schemas"]["UsageLimits.Meter"];
            weekly: components["schemas"]["UsageLimits.Meter"];
            monthly: components["schemas"]["UsageLimits.Meter"];
        };
        "UsageLimits.Info": {
            workspace: {
                id: string;
                name?: string;
                usageURL: string;
            };
            go?: components["schemas"]["UsageLimits.Go"];
            budgets: components["schemas"]["UsageLimits.Budget"][];
        };
        "UsageLimits.Meter": {
            percent: number;
            limited: boolean;
            /** @description Milliseconds since the Unix epoch */
            resetsAt: number;
        };
        V2Event: components["schemas"]["location.shutdown"] | components["schemas"]["models-dev.refreshed"] | components["schemas"]["credential.updated"] | components["schemas"]["credential.switched"] | components["schemas"]["integration.updated"] | components["schemas"]["provider.updated"] | components["schemas"]["model.updated"] | components["schemas"]["agent.updated"] | components["schemas"]["session.created"] | components["schemas"]["session.agent.selected"] | components["schemas"]["session.model.selected"] | components["schemas"]["session.moved"] | components["schemas"]["session.renamed"] | components["schemas"]["session.metadata.updated"] | components["schemas"]["session.permissions"] | components["schemas"]["session.viewed"] | components["schemas"]["session.archived"] | components["schemas"]["session.unarchived"] | components["schemas"]["session.usage.updated"] | components["schemas"]["session.deleted"] | components["schemas"]["session.forked"] | components["schemas"]["session.inbox.delivered"] | components["schemas"]["session.inbox.enqueued"] | components["schemas"]["session.inbox.cancelled"] | components["schemas"]["session.inbox.delivery.changed"] | components["schemas"]["session.execution.started"] | components["schemas"]["session.execution.succeeded"] | components["schemas"]["session.execution.failed"] | components["schemas"]["session.execution.interrupted"] | components["schemas"]["session.instructions.updated"] | components["schemas"]["session.synthetic"] | components["schemas"]["session.skill.activated"] | components["schemas"]["session.shell.started"] | components["schemas"]["session.shell.ended"] | components["schemas"]["session.step.started"] | components["schemas"]["session.step.streamed"] | components["schemas"]["session.step.ended"] | components["schemas"]["session.step.failed"] | components["schemas"]["session.text.started"] | components["schemas"]["session.text.delta"] | components["schemas"]["session.text.ended"] | components["schemas"]["session.reasoning.started"] | components["schemas"]["session.reasoning.delta"] | components["schemas"]["session.reasoning.ended"] | components["schemas"]["session.tool.input.started"] | components["schemas"]["session.tool.input.delta"] | components["schemas"]["session.tool.input.ended"] | components["schemas"]["session.tool.called"] | components["schemas"]["session.tool.progress"] | components["schemas"]["session.tool.success"] | components["schemas"]["session.tool.failed"] | components["schemas"]["session.retry.scheduled"] | components["schemas"]["session.compaction.started"] | components["schemas"]["session.compaction.delta"] | components["schemas"]["session.compaction.ended"] | components["schemas"]["session.compaction.failed"] | components["schemas"]["session.revert.staged"] | components["schemas"]["session.revert.cleared"] | components["schemas"]["session.revert.committed"] | components["schemas"]["filesystem.changed"] | components["schemas"]["reference.updated"] | components["schemas"]["permission.asked"] | components["schemas"]["permission.replied"] | components["schemas"]["plugin.updated"] | components["schemas"]["project.updated"] | components["schemas"]["worktree.updated"] | components["schemas"]["worktree.resolved"] | components["schemas"]["command.updated"] | components["schemas"]["config.updated"] | components["schemas"]["skill.updated"] | components["schemas"]["pty.created"] | components["schemas"]["pty.updated"] | components["schemas"]["pty.exited"] | components["schemas"]["pty.deleted"] | components["schemas"]["persistent-pty.added"] | components["schemas"]["persistent-pty.removed"] | components["schemas"]["persistent-pty.updated"] | components["schemas"]["shell.created"] | components["schemas"]["shell.exited"] | components["schemas"]["shell.deleted"] | components["schemas"]["form.created"] | components["schemas"]["form.replied"] | components["schemas"]["form.cancelled"] | components["schemas"]["websearch.updated"] | components["schemas"]["artifact.updated"] | components["schemas"]["SessionStatusUpdated"] | components["schemas"]["session.idle"] | components["schemas"]["tui.prompt.append"] | components["schemas"]["tui.command.execute"] | components["schemas"]["tui.toast.show"] | components["schemas"]["tui.session.select"] | components["schemas"]["installation.updated"] | components["schemas"]["installation.update-available"] | components["schemas"]["vcs.branch.updated"] | components["schemas"]["mcp.status.changed"] | components["schemas"]["mcp.resources.changed"] | components["schemas"]["V2Event.rpc"] | components["schemas"]["V2Event.server.connected"];
        "V2Event.rpc": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never> | null;
            type: string;
            location: components["schemas"]["Location.PublicRef"];
            data: Record<string, never>;
        };
        "V2Event.server.connected": {
            id: components["schemas"]["Event.ID"];
            metadata?: Record<string, never> | null;
            location?: components["schemas"]["Location.PublicRef"] | null;
            /** @enum {string} */
            type: "server.connected";
            data: unknown;
        };
        V2EventEncoded: string;
        "Vcs.Base": {
            name: string;
            ref: string;
            /** @enum {string} */
            source: "reflog" | "default";
        };
        "Vcs.Branch": {
            current?: string;
            default?: string;
        };
        "Vcs.BranchList": string[];
        "Vcs.FileStatus": {
            file: string;
            additions: number;
            deletions: number;
            /** @enum {string} */
            status: "added" | "deleted" | "modified";
        };
        "Vcs.Info": {
            provider?: string;
            branch: components["schemas"]["Vcs.Branch"];
        };
        /** @enum {string} */
        "Vcs.Mode": "working" | "branch" | "committed";
        /** @enum {string} */
        "Vcs.Untracked": "files" | "folders";
        VcsInitNotSupportedErrorEncoded: {
            /** @enum {string} */
            _tag: "VcsInitNotSupportedError";
            providerID: string;
            message: string;
        };
        VoiceModel: {
            model: string;
            provider: string;
            transports: components["schemas"]["VoiceTransportType"][];
            available: boolean;
        };
        VoiceModelsResponse: {
            data: {
                models: components["schemas"]["VoiceModel"][];
                default?: string | null;
            };
        };
        VoiceSessionResponse: {
            data: {
                transport: components["schemas"]["VoiceTransport"];
            };
        };
        VoiceTransport: components["schemas"]["VoiceWebRTCTransport"] | components["schemas"]["VoiceWebSocketTransport"];
        VoiceTransportInput: components["schemas"]["VoiceWebRTCTransportInput"] | components["schemas"]["VoiceWebSocketTransportInput"];
        /** @enum {string} */
        VoiceTransportType: "webrtc" | "websocket";
        VoiceWebRTCTransport: {
            /** @enum {string} */
            type: "webrtc";
            sdp: string;
        };
        VoiceWebRTCTransportInput: {
            /** @enum {string} */
            type: "webrtc";
            sdp: string;
            dcid?: number | ("Infinity" | "-Infinity" | "NaN") | null;
        };
        VoiceWebSocketTransport: {
            /** @enum {string} */
            type: "websocket";
            url: string;
            token: string;
            expiresAt: number | ("Infinity" | "-Infinity" | "NaN");
        };
        VoiceWebSocketTransportInput: {
            /** @enum {string} */
            type: "websocket";
        };
        "WebSearch.ID": string;
        "WebSearch.Provider": {
            id: components["schemas"]["WebSearch.ID"];
            name: string;
        };
        "WebSearch.ResponseEncoded": {
            providerID: components["schemas"]["WebSearch.ID"];
            results: components["schemas"]["WebSearch.Result"][];
        };
        "WebSearch.Result": {
            url: string;
            title?: string;
            content?: string;
            time: {
                published?: number;
            };
        };
        "Workspace.ID": string;
        "Worktree.CreateInput": {
            projectID: components["schemas"]["Project.ID"];
            from?: components["schemas"]["AbsolutePath"];
            branch?: string;
            directory?: components["schemas"]["AbsolutePath"];
            name?: string;
        };
        "Worktree.Directory": {
            directory: components["schemas"]["AbsolutePath"];
            strategy?: string;
        };
        "Worktree.Info": {
            directory: components["schemas"]["AbsolutePath"];
        };
        "Worktree.List": components["schemas"]["Worktree.Directory"][];
        "Worktree.RemoveInput": {
            projectID: components["schemas"]["Project.ID"];
            directory: components["schemas"]["AbsolutePath"];
            force: boolean;
        };
        WorktreeErrorEncoded: {
            /** @enum {string} */
            _tag: "WorktreeError";
            /** @enum {string} */
            name: "WorktreeError";
            data: {
                message: string;
                forceRequired?: boolean | null;
            };
        };
        "agent.updated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "agent.updated";
            location?: components["schemas"]["Location.Ref"];
            data: unknown;
        };
        "artifact.updated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "artifact.updated";
            location?: components["schemas"]["Location.Ref"];
            data: unknown;
        };
        "command.updated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "command.updated";
            location?: components["schemas"]["Location.Ref"];
            data: unknown;
        };
        "config.updated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "config.updated";
            location?: components["schemas"]["Location.Ref"];
            data: unknown;
        };
        "credential.switched": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "credential.switched";
            location?: components["schemas"]["Location.Ref"];
            data: {
                integrationID: components["schemas"]["Integration.ID"];
                credentialID: components["schemas"]["Credential.ID"] | null;
            };
        };
        "credential.updated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "credential.updated";
            location?: components["schemas"]["Location.Ref"];
            data: unknown;
        };
        "filesystem.changed": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "filesystem.changed";
            location?: components["schemas"]["Location.Ref"];
            data: {
                file: string;
                /** @enum {string} */
                event: "add" | "change" | "unlink";
            };
        };
        "form.cancelled": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "form.cancelled";
            location?: components["schemas"]["Location.Ref"];
            data: {
                id: components["schemas"]["Form.ID"];
                sessionID: string;
            };
        };
        "form.created": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "form.created";
            location?: components["schemas"]["Location.Ref"];
            data: {
                form: components["schemas"]["Form.Info_1"];
            };
        };
        "form.replied": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "form.replied";
            location?: components["schemas"]["Location.Ref"];
            data: {
                id: components["schemas"]["Form.ID"];
                sessionID: string;
                answer: components["schemas"]["Form.Answer_1"];
            };
        };
        "installation.update-available": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "installation.update-available";
            location?: components["schemas"]["Location.Ref"];
            data: {
                version: string;
            };
        };
        "installation.updated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "installation.updated";
            location?: components["schemas"]["Location.Ref"];
            data: {
                version: string;
            };
        };
        "integration.updated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "integration.updated";
            location?: components["schemas"]["Location.Ref"];
            data: unknown;
        };
        "location.shutdown": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "location.shutdown";
            location?: components["schemas"]["Location.Ref"];
            data: unknown;
        };
        "mcp.resources.changed": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "mcp.resources.changed";
            location?: components["schemas"]["Location.Ref"];
            data: {
                server: string;
            };
        };
        "mcp.status.changed": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "mcp.status.changed";
            location?: components["schemas"]["Location.Ref"];
            data: {
                server: string;
            };
        };
        "model.updated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "model.updated";
            location?: components["schemas"]["Location.Ref"];
            data: unknown;
        };
        "models-dev.refreshed": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "models-dev.refreshed";
            location?: components["schemas"]["Location.Ref"];
            data: unknown;
        };
        "permission.asked": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "permission.asked";
            location?: components["schemas"]["Location.Ref"];
            data: {
                id: components["schemas"]["Permission.ID"];
                sessionID: components["schemas"]["Session.ID"];
                action: string;
                resources: string[];
                save?: string[];
                metadata?: Record<string, never>;
                source?: components["schemas"]["Permission.Source"];
                message?: string;
            };
        };
        "permission.replied": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "permission.replied";
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                requestID: components["schemas"]["Permission.ID"];
                reply: components["schemas"]["Permission.Reply"];
            };
        };
        "persistent-pty.added": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "persistent-pty.added";
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                terminal: components["schemas"]["PersistentPty.Info"];
            };
        };
        "persistent-pty.removed": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "persistent-pty.removed";
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                ptyID: components["schemas"]["Pty.ID"];
            };
        };
        "persistent-pty.updated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "persistent-pty.updated";
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                terminal: components["schemas"]["PersistentPty.Info"];
            };
        };
        "plugin.updated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "plugin.updated";
            location?: components["schemas"]["Location.Ref"];
            data: unknown;
        };
        "project.updated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "project.updated";
            location?: components["schemas"]["Location.Ref"];
            data: {
                id: components["schemas"]["Project.ID"];
                canonical: components["schemas"]["AbsolutePath"];
                vcs?: components["schemas"]["Project.Vcs"];
                name?: string;
                icon?: components["schemas"]["Project.Icon"];
                commands?: components["schemas"]["Project.Commands"];
                time: components["schemas"]["Project.Time"];
                sandboxes: string[];
            };
        };
        "provider.updated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "provider.updated";
            location?: components["schemas"]["Location.Ref"];
            data: unknown;
        };
        "pty.created": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "pty.created";
            location?: components["schemas"]["Location.Ref"];
            data: {
                info: components["schemas"]["Pty"];
            };
        };
        "pty.deleted": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "pty.deleted";
            location?: components["schemas"]["Location.Ref"];
            data: {
                id: components["schemas"]["Pty.ID"];
            };
        };
        "pty.exited": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "pty.exited";
            location?: components["schemas"]["Location.Ref"];
            data: {
                id: components["schemas"]["Pty.ID"];
                exitCode: number;
            };
        };
        "pty.updated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "pty.updated";
            location?: components["schemas"]["Location.Ref"];
            data: {
                info: components["schemas"]["Pty"];
            };
        };
        "reference.updated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "reference.updated";
            location?: components["schemas"]["Location.Ref"];
            data: unknown;
        };
        "session.agent.selected": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.agent.selected";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                agent: components["schemas"]["Agent.ID"];
                previous?: components["schemas"]["Agent.ID"];
            };
        };
        "session.archived": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.archived";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
            };
        };
        "session.compaction.delta": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.compaction.delta";
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                text: string;
            };
        };
        "session.compaction.ended": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.compaction.ended";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                /** @enum {string} */
                reason: "auto" | "manual";
                model?: components["schemas"]["Model.Ref"];
                native?: components["schemas"]["Session.Message.Native"];
                text: string;
                cost?: components["schemas"]["Money.USD"];
                tokens?: components["schemas"]["TokenUsage.Info"];
            };
        };
        "session.compaction.failed": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.compaction.failed";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                /** @enum {string} */
                reason: "auto" | "manual";
                error: components["schemas"]["Session.StructuredError"];
                inputID?: components["schemas"]["Session.Message.ID"];
                cost?: components["schemas"]["Money.USD"];
                tokens?: components["schemas"]["TokenUsage.Info"];
            };
        };
        "session.compaction.started": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.compaction.started";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                /** @enum {string} */
                reason: "auto" | "manual";
                inputID?: components["schemas"]["Session.Message.ID"];
            };
        };
        "session.created": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.created";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                projectID: components["schemas"]["Project.ID"];
                location: components["schemas"]["Location.Ref"];
                subpath?: components["schemas"]["RelativePath"];
                parentID?: components["schemas"]["Session.ID"];
                slug: string;
                title?: string;
                agent?: components["schemas"]["Agent.ID"];
                model?: components["schemas"]["Model.Ref"];
                metadata?: components["schemas"]["Session.Metadata"];
                permissions?: components["schemas"]["Permission.Ruleset"];
                version: string;
            };
        };
        "session.deleted": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.deleted";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c3ea984aceae"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
            };
        };
        "session.execution.failed": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.execution.failed";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                error: components["schemas"]["Session.StructuredError"];
            };
        };
        "session.execution.interrupted": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.execution.interrupted";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                /** @enum {string} */
                reason: "user" | "shutdown" | "superseded" | "inactivity";
            };
        };
        "session.execution.started": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.execution.started";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
            };
        };
        "session.execution.succeeded": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.execution.succeeded";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
            };
        };
        "session.forked": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.forked";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c3ea984aceae"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                parentID: components["schemas"]["Session.ID"];
                boundary: components["schemas"]["Session.ForkBoundary"];
                instructions?: {
                    [key: string]: components["schemas"]["Instruction.Hash"];
                };
                instructionEntries?: components["schemas"]["InstructionEntry.Snapshot"];
            };
        };
        "session.idle": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.idle";
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
            };
        };
        "session.inbox.cancelled": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.inbox.cancelled";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                inboxID: components["schemas"]["Session.Message.ID"];
            };
        };
        "session.inbox.delivered": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.inbox.delivered";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                inboxID: components["schemas"]["Session.Message.ID"];
            };
        };
        "session.inbox.delivery.changed": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.inbox.delivery.changed";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                inboxID: components["schemas"]["Session.Message.ID"];
                delivery: components["schemas"]["Session.Inbox.Delivery"];
            };
        };
        "session.inbox.enqueued": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.inbox.enqueued";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                inboxID: components["schemas"]["Session.Message.ID"];
                item: components["schemas"]["Session.Inbox.Item"];
            };
        };
        "session.instructions.updated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.instructions.updated";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c3ea984aceae"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                delta: {
                    [key: string]: components["schemas"]["Instruction.Hash"] | "removed";
                };
                text?: string;
            };
        };
        "session.message.content.updated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.message.content.updated";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                messageID: components["schemas"]["Session.Message.ID"];
                content: components["schemas"]["Session.Message.AssistantContent.Encoded"][];
            };
        };
        "session.metadata.updated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.metadata.updated";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                metadata: components["schemas"]["Session.Metadata"];
            };
        };
        "session.model.selected": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.model.selected";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                model: components["schemas"]["Model.Ref"];
                previous?: components["schemas"]["Model.Ref"];
            };
        };
        "session.moved": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.moved";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                location: components["schemas"]["Location.Ref"];
                projectID: components["schemas"]["Project.ID"];
                subpath?: components["schemas"]["RelativePath"];
            };
        };
        "session.permissions": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.permissions";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                permissions: components["schemas"]["Permission.Ruleset"];
            };
        };
        "session.reasoning.delta": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.reasoning.delta";
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                assistantMessageID: components["schemas"]["Session.Message.ID"];
                ordinal: number;
                delta: string;
            };
        };
        "session.reasoning.ended": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.reasoning.ended";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                assistantMessageID: components["schemas"]["Session.Message.ID"];
                ordinal: number;
                text: string;
                native?: components["schemas"]["Session.Message.Native"];
            };
        };
        "session.reasoning.started": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.reasoning.started";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                assistantMessageID: components["schemas"]["Session.Message.ID"];
                ordinal: number;
                native?: components["schemas"]["Session.Message.Native"];
            };
        };
        "session.renamed": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.renamed";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                title: string;
            };
        };
        "session.retry.scheduled": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.retry.scheduled";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                assistantMessageID: components["schemas"]["Session.Message.ID"];
                attempt: number;
                at: number;
                error: components["schemas"]["Session.StructuredError"];
            };
        };
        "session.revert.cleared": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.revert.cleared";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
            };
        };
        "session.revert.committed": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.revert.committed";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                to: components["schemas"]["Session.Message.ID"];
            };
        };
        "session.revert.staged": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.revert.staged";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                revert: components["schemas"]["Session.Revert"];
            };
        };
        "session.shell.ended": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.shell.ended";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                shell: components["schemas"]["Shell.Info"];
                output: {
                    output: string;
                    cursor: number;
                    size: number;
                    truncated: boolean;
                };
            };
        };
        "session.shell.started": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.shell.started";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                shell: components["schemas"]["Shell.Info"];
            };
        };
        "session.skill.activated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.skill.activated";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                id: components["schemas"]["Skill.ID"];
                name: components["schemas"]["Skill.Name"];
                text: string;
            };
        };
        "session.step.ended": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.step.ended";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                assistantMessageID: components["schemas"]["Session.Message.ID"];
                /** @enum {string} */
                finish: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown";
                rawFinish?: string;
                native?: components["schemas"]["Session.Message.Native"];
                cost: components["schemas"]["Money.USD"];
                tokens: components["schemas"]["TokenUsage.Info"];
                snapshot?: components["schemas"]["Snapshot.ID"];
                files?: components["schemas"]["RelativePath"][];
            };
        };
        "session.step.failed": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.step.failed";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                assistantMessageID: components["schemas"]["Session.Message.ID"];
                error: components["schemas"]["Session.StructuredError"];
                finish?: "content-filter";
                rawFinish?: string;
                native?: components["schemas"]["Session.Message.Native"];
                cost?: components["schemas"]["Money.USD"];
                tokens?: components["schemas"]["TokenUsage.Info"];
                snapshot?: components["schemas"]["Snapshot.ID"];
                files?: components["schemas"]["RelativePath"][];
            };
        };
        "session.step.started": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.step.started";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                assistantMessageID: components["schemas"]["Session.Message.ID"];
                agent: components["schemas"]["Agent.ID"];
                model: components["schemas"]["Model.Ref"];
                snapshot?: components["schemas"]["Snapshot.ID"];
                started: number;
            };
        };
        "session.step.streamed": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.step.streamed";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                assistantMessageID: components["schemas"]["Session.Message.ID"];
            };
        };
        "session.synthetic": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.synthetic";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                text: string;
                description?: string;
                metadata?: Record<string, never>;
            };
        };
        "session.text.delta": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.text.delta";
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                assistantMessageID: components["schemas"]["Session.Message.ID"];
                ordinal: number;
                delta: string;
            };
        };
        "session.text.ended": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.text.ended";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                assistantMessageID: components["schemas"]["Session.Message.ID"];
                ordinal: number;
                text: string;
                native?: components["schemas"]["Session.Message.Native"];
            };
        };
        "session.text.started": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.text.started";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                assistantMessageID: components["schemas"]["Session.Message.ID"];
                ordinal: number;
            };
        };
        "session.tool.called": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.tool.called";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                assistantMessageID: components["schemas"]["Session.Message.ID"];
                id: string;
                input: Record<string, never>;
                executed: boolean;
                native?: components["schemas"]["Session.Message.Native"];
            };
        };
        "session.tool.failed": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.tool.failed";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c3ea984aceae"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                assistantMessageID: components["schemas"]["Session.Message.ID"];
                id: string;
                error: components["schemas"]["Session.StructuredError"];
                content?: [
                    components["schemas"]["Tool.Content"]
                ];
                metadata?: Record<string, never>;
                executed: boolean;
                native?: components["schemas"]["Session.Message.Native"];
            };
        };
        "session.tool.input.delta": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.tool.input.delta";
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                assistantMessageID: components["schemas"]["Session.Message.ID"];
                id: string;
                delta: string;
            };
        };
        "session.tool.input.ended": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.tool.input.ended";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                assistantMessageID: components["schemas"]["Session.Message.ID"];
                id: string;
                text: string;
            };
        };
        "session.tool.input.started": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.tool.input.started";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                assistantMessageID: components["schemas"]["Session.Message.ID"];
                id: string;
                name: string;
            };
        };
        "session.tool.progress": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.tool.progress";
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                assistantMessageID: components["schemas"]["Session.Message.ID"];
                id: string;
                metadata: Record<string, never>;
            };
        };
        "session.tool.success": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.tool.success";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c3ea984aceae"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                assistantMessageID: components["schemas"]["Session.Message.ID"];
                id: string;
                content: [
                    components["schemas"]["Tool.Content"]
                ];
                metadata?: Record<string, never>;
                executed: boolean;
                native?: components["schemas"]["Session.Message.Native"];
            };
        };
        "session.unarchived": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.unarchived";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
            };
        };
        "session.usage.recorded": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.usage.recorded";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                /** @enum {string} */
                source: "title" | "compaction";
                cost: components["schemas"]["Money.USD"];
                tokens: components["schemas"]["TokenUsage.Info"];
            };
        };
        "session.usage.updated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.usage.updated";
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                cost: components["schemas"]["Money.USD"];
                tokens: components["schemas"]["TokenUsage.Info"];
            };
        };
        "session.viewed": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "session.viewed";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"];
                idle: number;
            };
        };
        "shell.created": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "shell.created";
            location?: components["schemas"]["Location.Ref"];
            data: {
                info: components["schemas"]["Shell.Info"];
            };
        };
        "shell.deleted": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "shell.deleted";
            location?: components["schemas"]["Location.Ref"];
            data: {
                id: components["schemas"]["Shell.ID"];
            };
        };
        "shell.exited": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "shell.exited";
            location?: components["schemas"]["Location.Ref"];
            data: {
                id: components["schemas"]["Shell.ID"];
                exit?: number;
                /** @enum {string} */
                status: "running" | "exited" | "timeout" | "killed";
            };
        };
        "skill.updated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "skill.updated";
            location?: components["schemas"]["Location.Ref"];
            data: unknown;
        };
        "tui.command.execute": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "tui.command.execute";
            location?: components["schemas"]["Location.Ref"];
            data: {
                command: ("session.list" | "session.new" | "session.interrupt" | "session.background" | "session.compact" | "session.page.up" | "session.page.down" | "session.line.up" | "session.line.down" | "session.half.page.up" | "session.half.page.down" | "session.first" | "session.last" | "prompt.clear" | "prompt.submit" | "agent.cycle") | string;
            };
        };
        "tui.prompt.append": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "tui.prompt.append";
            location?: components["schemas"]["Location.Ref"];
            data: {
                text: string;
            };
        };
        "tui.session.select": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "tui.session.select";
            location?: components["schemas"]["Location.Ref"];
            data: {
                sessionID: components["schemas"]["Session.ID"] & unknown;
            };
        };
        "tui.toast.show": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "tui.toast.show";
            location?: components["schemas"]["Location.Ref"];
            data: {
                title?: string;
                message: string;
                /** @enum {string} */
                variant: "info" | "success" | "warning" | "error";
                duration?: number | null;
            };
        };
        "vcs.branch.updated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "vcs.branch.updated";
            location?: components["schemas"]["Location.Ref"];
            data: {
                branch?: string;
            };
        };
        "websearch.updated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "websearch.updated";
            location?: components["schemas"]["Location.Ref"];
            data: unknown;
        };
        "worktree.resolved": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "worktree.resolved";
            durable: {
                aggregateID: string;
                seq: components["schemas"]["Event.Seq"];
                version: components["schemas"]["Event.VersionEncoded_c77c5abcb68d"];
            };
            location?: components["schemas"]["Location.Ref"];
            data: {
                projectID: components["schemas"]["Project.ID"];
                directory: components["schemas"]["AbsolutePath"];
                previous: components["schemas"]["Project.ID"];
                adopted?: components["schemas"]["Project.ID"][];
            };
        };
        "worktree.updated": {
            id: components["schemas"]["Event.ID"];
            created: number;
            metadata?: Record<string, never>;
            /** @enum {string} */
            type: "worktree.updated";
            location?: components["schemas"]["Location.Ref"];
            data: {
                projectID: components["schemas"]["Project.ID"];
            };
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    "server.info": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description ServerInfo */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServerInfo"];
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
        };
    };
    "server.pair": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description PairingCode */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PairingCode"];
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
        };
    };
    "server.connect": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description PairingSession */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PairingSession"];
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
        };
    };
    "location.get": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Location.PublicInfo */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Location.PublicInfo"];
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "location.reload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "agent.list": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Agent.Info"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "agent.get": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                agentID: components["schemas"]["Agent.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Agent.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description AgentNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "plugin.list": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Plugin.Info"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "plugin.gui": {
        parameters: {
            query: {
                location?: {
                    directory?: string | null;
                };
                id: components["schemas"]["Plugin.ID"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Plugin.GuiBundle"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description PluginNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PluginNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "plugin.check": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    target?: string | null;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Plugin.Info"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "plugin.update": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    targets: string[];
                };
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "session.list": {
        parameters: {
            query?: {
                limit?: string;
                order?: "asc" | "desc";
                search?: string;
                parentID?: components["schemas"]["Session.ID"] | "null";
                archived?: "true" | "false";
                directory?: components["schemas"]["AbsolutePath"];
                project?: components["schemas"]["Project.ID"];
                subpath?: components["schemas"]["RelativePath"];
                cursor?: components["schemas"]["SessionsCursor"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description SessionsResponse */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionsResponse"];
                };
            };
            /** @description InvalidCursorError | InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidCursorErrorEncoded"] | components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
        };
    };
    "session.create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    id?: components["schemas"]["Session.ID"] | null;
                    parentID?: components["schemas"]["Session.ID"] | null;
                    title?: string | null;
                    agent?: components["schemas"]["Agent.ID"] | null;
                    model?: components["schemas"]["Model.Ref"] | null;
                    location?: components["schemas"]["Location.PublicRef"] | null;
                    metadata?: components["schemas"]["Session.Metadata"] | null;
                    permissions?: components["schemas"]["Permission.Ruleset"] | null;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Session.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
        };
    };
    "experimental.session.stats": {
        parameters: {
            query?: {
                from?: string;
                to?: string;
                project?: components["schemas"]["Project.ID"];
                timezone?: string;
                tools?: "none" | "summary" | "detail";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["SessionStats.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
        };
    };
    "experimental.session.import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    info: components["schemas"]["Session.Info"];
                    messages: unknown[];
                    location?: components["schemas"]["Location.PublicRef"] | null;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Session.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
            /** @description ConflictError */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConflictErrorEncoded"];
                };
            };
        };
    };
    "experimental.session.export": {
        parameters: {
            query?: {
                sanitize?: "true" | "false";
            };
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["SessionTransfer.Data"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
            /** @description UnknownError */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnknownErrorEncoded"];
                };
            };
        };
    };
    "session.active": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            [key: string]: components["schemas"]["SessionActive"];
                        };
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
        };
    };
    "session.get": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Session.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.remove": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.update": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    title?: string | null;
                    metadata?: components["schemas"]["Session.Metadata"] | null;
                    permissions?: components["schemas"]["Permission.Ruleset"] | null;
                    /** @description Archive the session with true or restore it with false. Repeating the current state is a no-op. */
                    archived?: boolean | null;
                };
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.fork": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    before?: components["schemas"]["Session.Message.ID"] | null;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Session.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError | MessageNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["MessageNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.switchAgent": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    agent: components["schemas"]["Agent.ID"];
                };
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.switchModel": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    model: components["schemas"]["Model.Ref"];
                };
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.move": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    directory: components["schemas"]["AbsolutePath"];
                    delivery?: components["schemas"]["Session.Inbox.Delivery"] | null;
                };
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.prompt": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    id?: components["schemas"]["Session.Message.ID"] | null;
                    text: string;
                    files?: components["schemas"]["PromptInput.FileAttachment"][];
                    agents?: components["schemas"]["Prompt.AgentAttachment"][];
                    skills?: components["schemas"]["PromptInput.SkillAttachment"][];
                    metadata?: Record<string, never>;
                    delivery?: components["schemas"]["Session.Inbox.Delivery"] | null;
                    resume?: boolean | null;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Session.Inbox.User"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ConflictError */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConflictErrorEncoded"];
                };
            };
        };
    };
    "session.command": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    text: string;
                    files?: components["schemas"]["PromptInput.FileAttachment"][];
                    agents?: components["schemas"]["Prompt.AgentAttachment"][];
                    skills?: components["schemas"]["PromptInput.SkillAttachment"][];
                    delivery?: components["schemas"]["Session.Inbox.Delivery"] | null;
                };
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError | CommandNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["CommandNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description CommandExecutionError */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommandExecutionErrorEncoded"];
                };
            };
        };
    };
    "experimental.session.skill": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    id: components["schemas"]["Skill.ID"];
                    resume?: boolean | null;
                };
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError | SkillNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["SkillNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.synthetic": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    id?: components["schemas"]["Session.Message.ID"] | null;
                    text: string;
                    description?: string | null;
                    metadata?: Record<string, never>;
                    delivery?: components["schemas"]["Session.Inbox.Delivery"] | null;
                    resume?: boolean | null;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Session.Inbox.Synthetic"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
            /** @description ConflictError */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConflictErrorEncoded"];
                };
            };
        };
    };
    "session.shell": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    id?: components["schemas"]["Session.Message.ID"] | null;
                    command: string;
                };
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.compact": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    id?: components["schemas"]["Session.Message.ID"] | null;
                    delivery?: components["schemas"]["Session.Inbox.Delivery"] | null;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Session.Inbox.Compaction"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
            /** @description ConflictError */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConflictErrorEncoded"];
                };
            };
        };
    };
    "experimental.session.wait": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "session.revert.stage": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    messageID: components["schemas"]["Session.Message.ID"];
                    files?: boolean | null;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Session.Revert"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description MessageNotFoundError | SessionNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessageNotFoundErrorEncoded"] | components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description SessionBusyError */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionBusyErrorEncoded"];
                };
            };
            /** @description UnknownError */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnknownErrorEncoded"];
                };
            };
        };
    };
    "session.revert.clear": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description SessionBusyError */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionBusyErrorEncoded"];
                };
            };
            /** @description UnknownError */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnknownErrorEncoded"];
                };
            };
        };
    };
    "session.revert.commit": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
            /** @description SessionBusyError */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionBusyErrorEncoded"];
                };
            };
        };
    };
    "session.context": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Session.Message.Info"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
            /** @description UnknownError */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnknownErrorEncoded"];
                };
            };
        };
    };
    "session.diff": {
        parameters: {
            query?: {
                from?: components["schemas"]["Session.Message.ID"];
                to?: components["schemas"]["Session.Message.ID"];
                context?: string;
            };
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["FileDiff.Info"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description MessageNotFoundError | SessionNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessageNotFoundErrorEncoded"] | components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description UnknownError */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnknownErrorEncoded"];
                };
            };
        };
    };
    "session.inbox.list": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Session.Inbox.Info"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.inbox.cancel": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
                inboxID: components["schemas"]["Session.Message.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.inbox.update": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
                inboxID: components["schemas"]["Session.Message.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    delivery: components["schemas"]["Session.Inbox.Delivery"];
                };
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
            /** @description ConflictError */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConflictErrorEncoded"];
                };
            };
        };
    };
    "experimental.session.instructions.entry.list": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["InstructionEntry.Info"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
        };
    };
    "experimental.session.instructions.entry.put": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
                key: components["schemas"]["InstructionEntry.Key"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    value: unknown;
                };
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
            /** @description InstructionEntryValueTooLargeError */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InstructionEntryValueTooLargeErrorEncoded"];
                };
            };
        };
    };
    "experimental.session.instructions.entry.remove": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
                key: components["schemas"]["InstructionEntry.Key"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.generate": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    prompt: string;
                };
            };
        };
        responses: {
            /** @description SessionGenerateResponse */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionGenerateResponse"];
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.session.log": {
        parameters: {
            query?: {
                after?: string;
                follow?: "true" | "false";
            };
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": {
                        id?: string | null;
                        event: string;
                        data: components["schemas"]["SessionLogItemEncoded"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.interrupt": {
        parameters: {
            query?: {
                resume?: "true" | "false";
            };
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description SessionInterruptResponse */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionInterruptResponse"];
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.background": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.message.get": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
                messageID: components["schemas"]["Session.Message.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Session.Message.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError | MessageNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["MessageNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.form.list": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Form.Info"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.form.create": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Form.CreatePayload"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Form.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ConflictError */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConflictErrorEncoded"];
                };
            };
        };
    };
    "session.form.get": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: string;
                formID: components["schemas"]["Form.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Form.Detail"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError | FormNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["FormNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.form.cancel": {
        parameters: {
            query?: {
                message?: string;
            };
            header?: never;
            path: {
                sessionID: string;
                formID: components["schemas"]["Form.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError | FormNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["FormNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description FormAlreadySettledError */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FormAlreadySettledErrorEncoded"];
                };
            };
        };
    };
    "session.form.reply": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: string;
                formID: components["schemas"]["Form.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Form.Reply"];
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description FormInvalidAnswerError | InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FormInvalidAnswerErrorEncoded"] | components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError | FormNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["FormNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description FormAlreadySettledError */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FormAlreadySettledErrorEncoded"];
                };
            };
        };
    };
    "session.environment": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    variables: {
                        [key: string]: string;
                    };
                };
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.view": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    idle: number;
                };
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.message.list": {
        parameters: {
            query?: {
                limit?: string;
                order?: "asc" | "desc";
                cursor?: string;
                type?: "agent-switched" | "model-switched" | "location-switched" | "user" | "synthetic" | "system" | "skill" | "shell" | "assistant" | "compaction" | "idle";
            };
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description SessionMessagesResponse */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionMessagesResponse"];
                };
            };
            /** @description InvalidCursorError | InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidCursorErrorEncoded"] | components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
            /** @description UnknownError */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnknownErrorEncoded"];
                };
            };
        };
    };
    "model.list": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
                types?: components["schemas"]["Model.Type"] | components["schemas"]["Model.Type"][];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Model.Info"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "model.default": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Model.Info"] | null;
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.generate.text": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    prompt: string;
                    model?: components["schemas"]["Model.Ref"] | null;
                };
            };
        };
        responses: {
            /** @description GenerateTextResponse */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerateTextResponse"];
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ProviderNotFoundError | ModelNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderNotFoundErrorEncoded"] | components["schemas"]["ModelNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description UnsupportedModelError */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnsupportedModelErrorEncoded"];
                };
            };
            /** @description ProviderRequestError */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderRequestErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.generate.textLegacy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    prompt: string;
                    model?: components["schemas"]["Model.Ref"] | null;
                };
            };
        };
        responses: {
            /** @description GenerateTextResponse */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerateTextResponse"];
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ProviderNotFoundError | ModelNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderNotFoundErrorEncoded"] | components["schemas"]["ModelNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description UnsupportedModelError */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnsupportedModelErrorEncoded"];
                };
            };
            /** @description ProviderRequestError */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderRequestErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.generate.image": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Generate.ImageRequest"];
            };
        };
        responses: {
            /** @description GenerateImageResponse */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerateImageResponse"];
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ProviderNotFoundError | ModelNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderNotFoundErrorEncoded"] | components["schemas"]["ModelNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description UnsupportedModelError */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnsupportedModelErrorEncoded"];
                };
            };
            /** @description ProviderRequestError */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderRequestErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.generate.decisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Generate.DecisionRequest"];
            };
        };
        responses: {
            /** @description GenerateDecisionsResponse */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerateDecisionsResponse"];
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ProviderNotFoundError | ModelNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderNotFoundErrorEncoded"] | components["schemas"]["ModelNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description UnsupportedModelError */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnsupportedModelErrorEncoded"];
                };
            };
            /** @description ProviderRequestError */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderRequestErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.voice.models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description VoiceModelsResponse */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VoiceModelsResponse"];
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.voice.session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    model: string;
                    session?: Record<string, never> | null;
                    transport: components["schemas"]["VoiceTransportInput"];
                };
            };
        };
        responses: {
            /** @description VoiceSessionResponse */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VoiceSessionResponse"];
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "provider.list": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Provider.Info"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "provider.get": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                providerID: components["schemas"]["Provider.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Provider.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ProviderNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "integration.list": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Integration.Info"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "integration.get": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                integrationID: components["schemas"]["Integration.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Integration.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description IntegrationNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntegrationNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "experimental.integration.wellknown.add": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    url: string;
                };
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "integration.connect.key": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                integrationID: components["schemas"]["Integration.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    key: string;
                    answer?: components["schemas"]["Form.Answer"] | null;
                    label?: string | null;
                };
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description IntegrationNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntegrationNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "integration.connect.external": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                integrationID: components["schemas"]["Integration.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    methodID: components["schemas"]["Integration.MethodID"];
                    answer?: components["schemas"]["Form.Answer"] | null;
                    label?: string | null;
                };
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description IntegrationNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntegrationNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "integration.oauth.connect": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                integrationID: components["schemas"]["Integration.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    methodID: components["schemas"]["Integration.MethodID"];
                    answer?: components["schemas"]["Form.Answer"] | null;
                    label?: string | null;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Integration.AttemptEncoded"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "integration.oauth.status": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                integrationID: components["schemas"]["Integration.ID"];
                attemptID: components["schemas"]["Integration.AttemptID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Integration.AttemptStatus"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description IntegrationNotFoundError | IntegrationAttemptNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntegrationNotFoundErrorEncoded"] | components["schemas"]["IntegrationAttemptNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "integration.oauth.cancel": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                integrationID: components["schemas"]["Integration.ID"];
                attemptID: components["schemas"]["Integration.AttemptID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "integration.oauth.complete": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                integrationID: components["schemas"]["Integration.ID"];
                attemptID: components["schemas"]["Integration.AttemptID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    code?: string | null;
                };
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description IntegrationNotFoundError | IntegrationAttemptNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntegrationNotFoundErrorEncoded"] | components["schemas"]["IntegrationAttemptNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "integration.command.connect": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                integrationID: components["schemas"]["Integration.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    methodID: components["schemas"]["Integration.MethodID"];
                    label?: string | null;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Integration.CommandAttempt"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description IntegrationNotFoundError | IntegrationMethodNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntegrationNotFoundErrorEncoded"] | components["schemas"]["IntegrationMethodNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "integration.command.status": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                integrationID: components["schemas"]["Integration.ID"];
                attemptID: components["schemas"]["Integration.AttemptID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Integration.CommandAttemptStatus"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description IntegrationNotFoundError | IntegrationAttemptNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntegrationNotFoundErrorEncoded"] | components["schemas"]["IntegrationAttemptNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "integration.command.cancel": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                integrationID: components["schemas"]["Integration.ID"];
                attemptID: components["schemas"]["Integration.AttemptID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "mcp.list": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Mcp.Server"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "experimental.mcp.add": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                server: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    config: components["schemas"]["Mcp.LocalConfigEncoded"] | components["schemas"]["Mcp.RemoteConfigEncoded"];
                };
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "experimental.mcp.remove": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                server: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description McpServerNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["McpServerNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "experimental.mcp.connect": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                server: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description McpServerNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["McpServerNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "experimental.mcp.disconnect": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                server: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description McpServerNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["McpServerNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "mcp.resource.catalog": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Mcp.ResourceCatalog"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "experimental.mcp.client.token": {
        parameters: {
            query: {
                location?: {
                    directory?: string | null;
                };
                name: string;
            };
            header?: {
                "x-opencode-ticket"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["PtyTicket.ConnectToken"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ForbiddenError */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForbiddenErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "experimental.mcp.client": {
        parameters: {
            query: {
                location?: {
                    directory?: string | null;
                };
                name: string;
                ticket?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": boolean;
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ForbiddenError */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForbiddenErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "credential.list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Credential.Entry"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
        };
    };
    "credential.create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Credential.CreateInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Credential.Entry"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ConflictError */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConflictErrorEncoded"];
                };
            };
        };
    };
    "credential.remove": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                credentialID: components["schemas"]["Credential.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
        };
    };
    "credential.update": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                credentialID: components["schemas"]["Credential.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    label: string;
                };
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
        };
    };
    "credential.activate": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                credentialID: components["schemas"]["Credential.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
        };
    };
    "project.list": {
        parameters: {
            query?: {
                archived?: "true" | "false";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Project"][];
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
        };
    };
    "project.update": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectID: components["schemas"]["Project.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    canonical?: components["schemas"]["AbsolutePath"];
                    name?: string;
                    icon?: components["schemas"]["Project.Icon"];
                    commands?: components["schemas"]["Project.Commands"];
                };
            };
        };
        responses: {
            /** @description Project */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Project"];
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ProjectNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectNotFoundErrorEncoded"];
                };
            };
        };
    };
    "form.list": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Form.Info"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "permission.request.list": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Permission.Request"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "permission.saved.list": {
        parameters: {
            query?: {
                projectID?: components["schemas"]["Project.ID"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["PermissionSaved.Info"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "permission.saved.remove": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["PermissionSaved.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
        };
    };
    "permission.saved.update": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["schemas"]["PermissionSaved.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    action?: string | null;
                    resource?: string | null;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["PermissionSaved.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description PermissionSavedNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PermissionSavedNotFoundErrorEncoded"];
                };
            };
            /** @description ConflictError */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConflictErrorEncoded"];
                };
            };
        };
    };
    "session.permission.list": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Permission.Request"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.permission.create": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    id?: components["schemas"]["Permission.ID"] | null;
                    action: string;
                    resources: string[];
                    save?: string[];
                    metadata?: Record<string, never>;
                    source?: components["schemas"]["Permission.Source"];
                    agent?: components["schemas"]["Agent.ID"] | null;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            id: components["schemas"]["Permission.ID"];
                            effect: components["schemas"]["Permission.Effect"];
                        };
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.permission.get": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
                requestID: components["schemas"]["Permission.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Permission.Request"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError | PermissionNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["PermissionNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "session.permission.reply": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
                requestID: components["schemas"]["Permission.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    decision: components["schemas"]["Permission.Reply"];
                    message?: string | null;
                };
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError | PermissionNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["PermissionNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "fs.read": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description FileNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FileNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "fs.list": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
                path?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["FileSystem.Entry"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description FileNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FileNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "fs.find": {
        parameters: {
            query: {
                location?: {
                    directory?: string | null;
                };
                query: string;
                type?: "file" | "directory";
                limit?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["FileSystem.Entry"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "experimental.fs.write": {
        parameters: {
            query: {
                location?: {
                    directory?: string | null;
                };
                path: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/octet-stream": string;
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["FileSystem.Write"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "experimental.fs.watch": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description A file path relative to the requested location. */
                    path: string;
                };
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description FileNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FileNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.fs.unwatch": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description A file path relative to the requested location. */
                    path: string;
                };
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "command.list": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Command.Info"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "skill.list": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Skill.Info"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "rpc.call": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                rpcID: string;
                method: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Rpc.Input"];
            };
        };
        responses: {
            /** @description Rpc.Output */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Rpc.Output"];
                };
            };
            /** @description RpcError | InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RpcErrorEncoded"] | components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description RpcInternalError */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RpcInternalErrorEncoded"];
                };
            };
        };
    };
    "event.subscribe": {
        parameters: {
            query?: {
                types?: ("location.shutdown" | "models-dev.refreshed" | "credential.updated" | "credential.switched" | "integration.updated" | "provider.updated" | "model.updated" | "agent.updated" | "session.created" | "session.agent.selected" | "session.model.selected" | "session.moved" | "session.renamed" | "session.metadata.updated" | "session.permissions" | "session.viewed" | "session.archived" | "session.unarchived" | "session.usage.updated" | "session.deleted" | "session.forked" | "session.inbox.delivered" | "session.inbox.enqueued" | "session.inbox.cancelled" | "session.inbox.delivery.changed" | "session.execution.started" | "session.execution.succeeded" | "session.execution.failed" | "session.execution.interrupted" | "session.instructions.updated" | "session.synthetic" | "session.skill.activated" | "session.shell.started" | "session.shell.ended" | "session.step.started" | "session.step.streamed" | "session.step.ended" | "session.step.failed" | "session.text.started" | "session.text.delta" | "session.text.ended" | "session.reasoning.started" | "session.reasoning.delta" | "session.reasoning.ended" | "session.tool.input.started" | "session.tool.input.delta" | "session.tool.input.ended" | "session.tool.called" | "session.tool.progress" | "session.tool.success" | "session.tool.failed" | "session.retry.scheduled" | "session.compaction.started" | "session.compaction.delta" | "session.compaction.ended" | "session.compaction.failed" | "session.revert.staged" | "session.revert.cleared" | "session.revert.committed" | "filesystem.changed" | "reference.updated" | "permission.asked" | "permission.replied" | "plugin.updated" | "project.updated" | "worktree.updated" | "worktree.resolved" | "command.updated" | "config.updated" | "skill.updated" | "pty.created" | "pty.updated" | "pty.exited" | "pty.deleted" | "persistent-pty.added" | "persistent-pty.removed" | "persistent-pty.updated" | "shell.created" | "shell.exited" | "shell.deleted" | "form.created" | "form.replied" | "form.cancelled" | "websearch.updated" | "artifact.updated" | "session.status" | "session.idle" | "tui.prompt.append" | "tui.command.execute" | "tui.toast.show" | "tui.session.select" | "installation.updated" | "installation.update-available" | "vcs.branch.updated" | "mcp.status.changed" | "mcp.resources.changed") | string | (("location.shutdown" | "models-dev.refreshed" | "credential.updated" | "credential.switched" | "integration.updated" | "provider.updated" | "model.updated" | "agent.updated" | "session.created" | "session.agent.selected" | "session.model.selected" | "session.moved" | "session.renamed" | "session.metadata.updated" | "session.permissions" | "session.viewed" | "session.archived" | "session.unarchived" | "session.usage.updated" | "session.deleted" | "session.forked" | "session.inbox.delivered" | "session.inbox.enqueued" | "session.inbox.cancelled" | "session.inbox.delivery.changed" | "session.execution.started" | "session.execution.succeeded" | "session.execution.failed" | "session.execution.interrupted" | "session.instructions.updated" | "session.synthetic" | "session.skill.activated" | "session.shell.started" | "session.shell.ended" | "session.step.started" | "session.step.streamed" | "session.step.ended" | "session.step.failed" | "session.text.started" | "session.text.delta" | "session.text.ended" | "session.reasoning.started" | "session.reasoning.delta" | "session.reasoning.ended" | "session.tool.input.started" | "session.tool.input.delta" | "session.tool.input.ended" | "session.tool.called" | "session.tool.progress" | "session.tool.success" | "session.tool.failed" | "session.retry.scheduled" | "session.compaction.started" | "session.compaction.delta" | "session.compaction.ended" | "session.compaction.failed" | "session.revert.staged" | "session.revert.cleared" | "session.revert.committed" | "filesystem.changed" | "reference.updated" | "permission.asked" | "permission.replied" | "plugin.updated" | "project.updated" | "worktree.updated" | "worktree.resolved" | "command.updated" | "config.updated" | "skill.updated" | "pty.created" | "pty.updated" | "pty.exited" | "pty.deleted" | "persistent-pty.added" | "persistent-pty.removed" | "persistent-pty.updated" | "shell.created" | "shell.exited" | "shell.deleted" | "form.created" | "form.replied" | "form.cancelled" | "websearch.updated" | "artifact.updated" | "session.status" | "session.idle" | "tui.prompt.append" | "tui.command.execute" | "tui.toast.show" | "tui.session.select" | "installation.updated" | "installation.update-available" | "vcs.branch.updated" | "mcp.status.changed" | "mcp.resources.changed") | string)[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": {
                        id?: string | null;
                        event: string;
                        data: components["schemas"]["V2EventEncoded"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
        };
    };
    "pty.list": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Pty"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "pty.create": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    command?: string;
                    args?: string[];
                    cwd?: string;
                    title?: string;
                    env?: {
                        [key: string]: string;
                    };
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Pty"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "pty.get": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                ptyID: components["schemas"]["Pty.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Pty"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description PtyNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PtyNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "pty.update": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                ptyID: components["schemas"]["Pty.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    title?: string;
                    size?: {
                        rows: number;
                        cols: number;
                    };
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Pty"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description PtyNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PtyNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "pty.remove": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                ptyID: components["schemas"]["Pty.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description PtyNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PtyNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "pty.connect.token": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: {
                "x-opencode-ticket"?: string;
            };
            path: {
                ptyID: components["schemas"]["Pty.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["PtyTicket.ConnectToken"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ForbiddenError */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForbiddenErrorEncoded"];
                };
            };
            /** @description PtyNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PtyNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "pty.connect": {
        parameters: {
            query?: {
                "location[directory]"?: string;
                cursor?: string;
                ticket?: string;
            };
            header?: never;
            path: {
                ptyID: components["schemas"]["Pty.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": boolean;
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ForbiddenError */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForbiddenErrorEncoded"];
                };
            };
            /** @description PtyNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PtyNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "experimental.persistentPty.read": {
        parameters: {
            query?: {
                lines?: string;
            };
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["PersistentPty.ReadResult"] | null;
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.persistentPty.list": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["PersistentPty.Info"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.persistentPty.create": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionID: components["schemas"]["Session.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PersistentPty.CreateInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["PersistentPty.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.persistentPty.shutdown": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.persistentPty.handoff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        handoff: components["schemas"]["PersistentPty.Handoff"] | null;
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.persistentPty.get": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                ptyID: components["schemas"]["Pty.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["PersistentPty.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description PtyNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PtyNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.persistentPty.update": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                ptyID: components["schemas"]["Pty.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PersistentPty.UpdateInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["PersistentPty.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description PtyNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PtyNotFoundErrorEncoded"];
                };
            };
            /** @description PtyFeatureUnsupportedError */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PtyFeatureUnsupportedErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.persistentPty.remove": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                ptyID: components["schemas"]["Pty.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description PtyNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PtyNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.persistentPty.snapshot": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                ptyID: components["schemas"]["Pty.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["PersistentPty.Snapshot"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description PtyNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PtyNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.persistentPty.connectToken": {
        parameters: {
            query?: never;
            header?: {
                "x-opencode-ticket"?: string;
            };
            path: {
                ptyID: components["schemas"]["Pty.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["PtyTicket.ConnectToken"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ForbiddenError */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForbiddenErrorEncoded"];
                };
            };
            /** @description PtyNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PtyNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.persistentPty.connect": {
        parameters: {
            query?: {
                cursor?: string;
                role?: string;
                attachment_id?: string;
                takeover?: string;
                input_protocol?: string;
                ticket?: string;
            };
            header?: never;
            path: {
                ptyID: components["schemas"]["Pty.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": boolean;
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ForbiddenError */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForbiddenErrorEncoded"];
                };
            };
            /** @description PtyNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PtyNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.media.get": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                hash: components["schemas"]["MediaHash"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description FileNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FileNotFoundErrorEncoded"];
                };
            };
        };
    };
    "experimental.schedule.list": {
        parameters: {
            query: {
                sessionID: components["schemas"]["Session.ID"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Schedule.Info"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ForbiddenError */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForbiddenErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
        };
    };
    "experimental.schedule.create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Schedule.CreatePayload"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Schedule.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ForbiddenError */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForbiddenErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
        };
    };
    "experimental.schedule.get": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scheduleID: components["schemas"]["Schedule.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Schedule.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ForbiddenError */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForbiddenErrorEncoded"];
                };
            };
            /** @description ScheduleNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScheduleNotFoundErrorEncoded"];
                };
            };
        };
    };
    "experimental.schedule.delete": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scheduleID: components["schemas"]["Schedule.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ForbiddenError */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForbiddenErrorEncoded"];
                };
            };
            /** @description ScheduleNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScheduleNotFoundErrorEncoded"];
                };
            };
        };
    };
    "experimental.schedule.pause": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scheduleID: components["schemas"]["Schedule.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Schedule.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ForbiddenError */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForbiddenErrorEncoded"];
                };
            };
            /** @description ScheduleNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScheduleNotFoundErrorEncoded"];
                };
            };
        };
    };
    "experimental.schedule.resume": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scheduleID: components["schemas"]["Schedule.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Schedule.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ForbiddenError */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForbiddenErrorEncoded"];
                };
            };
            /** @description ScheduleNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScheduleNotFoundErrorEncoded"];
                };
            };
        };
    };
    "experimental.artifacts.providers": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Artifact.Provider"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ForbiddenError */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForbiddenErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.artifacts.list": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
                sessionID?: components["schemas"]["Session.ID"];
                provider?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Artifact.Info"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ForbiddenError */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForbiddenErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.artifacts.create": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Artifact.CreateInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Artifact.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ForbiddenError */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForbiddenErrorEncoded"];
                };
            };
            /** @description ProviderNotFoundError | SessionNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderNotFoundErrorEncoded"] | components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.artifacts.get": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                artifactID: components["schemas"]["Artifact.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Artifact.Content"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ForbiddenError */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForbiddenErrorEncoded"];
                };
            };
            /** @description ArtifactNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ArtifactNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.artifacts.delete": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                artifactID: components["schemas"]["Artifact.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ForbiddenError */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForbiddenErrorEncoded"];
                };
            };
            /** @description ArtifactNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ArtifactNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.artifacts.update": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                artifactID: components["schemas"]["Artifact.ID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Artifact.UpdateInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Artifact.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ForbiddenError */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForbiddenErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError | ArtifactNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"] | components["schemas"]["ArtifactNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.artifacts.view": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                artifactID: components["schemas"]["Artifact.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ForbiddenError */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForbiddenErrorEncoded"];
                };
            };
            /** @description FileNotFoundError | ArtifactNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FileNotFoundErrorEncoded"] | components["schemas"]["ArtifactNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.job.list": {
        parameters: {
            query?: {
                sessionID?: components["schemas"]["Session.ID"];
                kind?: components["schemas"]["Job.Kind"];
                status?: components["schemas"]["Job.Status"];
                descendants?: "true" | "false";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Job.Info"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description SessionNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionNotFoundErrorEncoded"];
                };
            };
        };
    };
    "shell.list": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Shell.Info"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "shell.create": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    command: string;
                    cwd?: string;
                    timeout?: number;
                    metadata?: Record<string, never>;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Shell.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "shell.get": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                id: components["schemas"]["Shell.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Shell.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ShellNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShellNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "shell.remove": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path: {
                id: components["schemas"]["Shell.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "shell.output": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
                cursor?: string;
                limit?: string;
            };
            header?: never;
            path: {
                id: components["schemas"]["Shell.ID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: {
                            output: string;
                            cursor: number;
                            size: number;
                            truncated: boolean;
                        };
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ShellNotFoundError | LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShellNotFoundErrorEncoded"] | components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "reference.list": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Reference.Info"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "worktree.list": {
        parameters: {
            query: {
                projectID: components["schemas"]["Project.ID"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Worktree.List */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Worktree.List"];
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ProjectNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectNotFoundErrorEncoded"];
                };
            };
        };
    };
    "worktree.create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Worktree.CreateInput"];
            };
        };
        responses: {
            /** @description Worktree.Info */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Worktree.Info"];
                };
            };
            /** @description WorktreeError | InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorktreeErrorEncoded"] | components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ProjectNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectNotFoundErrorEncoded"];
                };
            };
        };
    };
    "worktree.remove": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Worktree.RemoveInput"];
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description WorktreeError | InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorktreeErrorEncoded"] | components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ProjectNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectNotFoundErrorEncoded"];
                };
            };
        };
    };
    "worktree.refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    projectID: components["schemas"]["Project.ID"];
                };
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description WorktreeError | InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorktreeErrorEncoded"] | components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description ProjectNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProjectNotFoundErrorEncoded"];
                };
            };
        };
    };
    "vcs.init": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
                provider?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ConflictError */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConflictErrorEncoded"];
                };
            };
            /** @description VcsInitNotSupportedError */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VcsInitNotSupportedErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "vcs.get": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Vcs.Info"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "vcs.base": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Vcs.Base"] | null;
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "vcs.status": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Vcs.FileStatus"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "vcs.branch.list": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
                search?: string;
                limit?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["Vcs.BranchList"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "vcs.diff": {
        parameters: {
            query: {
                location?: {
                    directory?: string | null;
                };
                mode: components["schemas"]["Vcs.Mode"];
                base?: string;
                context?: string;
                untracked?: components["schemas"]["Vcs.Untracked"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["FileDiff.Info"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "debug.heapDump": {
        parameters: {
            query?: {
                directory?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        path: string;
                        pid: number;
                        /** @description The server process's memory in bytes, read just before the snapshot (Node's process.memoryUsage()). rss covers native memory the snapshot cannot show. */
                        memory: {
                            rss: number | ("Infinity" | "-Infinity" | "NaN");
                            heapTotal: number | ("Infinity" | "-Infinity" | "NaN");
                            heapUsed: number | ("Infinity" | "-Infinity" | "NaN");
                            external: number | ("Infinity" | "-Infinity" | "NaN");
                            arrayBuffers: number | ("Infinity" | "-Infinity" | "NaN");
                        };
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description UnknownError */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnknownErrorEncoded"];
                };
            };
        };
    };
    "debug.location.list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Location.PublicRef"][];
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
        };
    };
    "debug.location.evict": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
        };
    };
    "experimental.migration.v1.status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        status: "required" | "completed";
                    } | {
                        /** @enum {string} */
                        status: "running";
                        progress: {
                            label: string;
                            numerator?: number | null;
                            denominator?: number | null;
                        };
                    } | {
                        /** @enum {string} */
                        status: "error";
                        error: string;
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
        };
    };
    "websearch.providers": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["WebSearch.Provider"][];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "websearch.query": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    query: string;
                    providerID?: components["schemas"]["WebSearch.ID"];
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["WebSearch.ResponseEncoded"];
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "experimental.usage.limits": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        location: components["schemas"]["Location.PublicRef"];
                        data: components["schemas"]["UsageLimits.Info"] | null;
                    };
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
            /** @description ServiceUnavailableError */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServiceUnavailableErrorEncoded"];
                };
            };
        };
    };
    "config.get": {
        parameters: {
            query?: {
                location?: {
                    directory?: string | null;
                };
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Config.Entry"][];
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "config.shells": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConfigShell.Option"][];
                };
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
    "experimental.config.update": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Config.Patch"];
            };
        };
        responses: {
            /** @description <No Content> */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description InvalidRequestError */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvalidRequestErrorEncoded"];
                };
            };
            /** @description UnauthorizedError */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnauthorizedErrorEncoded"];
                };
            };
            /** @description LocationNotFoundError */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LocationNotFoundErrorEncoded"];
                };
            };
        };
    };
}
