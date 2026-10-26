# Security

Report suspected vulnerabilities privately to [team@noisefactor.io](mailto:team@noisefactor.io), with “Foundry security” in the subject. Do not publish exploit details or sensitive data in a public issue.

Include the affected source revision or deployed build, browser and operating system, reproduction steps, and expected versus observed behavior. Use a minimal example without credentials, personal data, or private workspace files. Describe any suspected credential exposure without sending the credential itself.

The local Node server is intended for development and binds to the loopback interface by default. Changing its host setting makes it reachable beyond that interface; it does not add authentication or production hosting controls.

Foundry loads runtime assets from Noise Factor services. Local workspaces are stored in the browser. Sharing and live collaboration send the selected content to their respective services. Treat imported effect files and session content as untrusted, and share only work you intend others to access.
