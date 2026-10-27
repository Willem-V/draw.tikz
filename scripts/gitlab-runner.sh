#!/usr/bin/env bash
# Installs, registers and starts a GitLab runner on this machine (Docker executor) for the Pages CI job.
#
#   scripts/gitlab-runner.sh            install (if needed), register (if needed) and start the runner
#   scripts/gitlab-runner.sh status     show the registered runners and whether the service runs
#   scripts/gitlab-runner.sh stop       stop the runner service
#
# Registering needs a runner authentication token (glrt-...): in GitLab go to
# Settings > CI/CD > Runners > New project runner, tick "Run untagged jobs" and create it.
# The token is read from $GITLAB_RUNNER_TOKEN or asked for (input hidden), it is never stored in this repository.
set -euo pipefail

GITLAB_URL="https://gitlab.esat.kuleuven.be"
DOCKER_IMAGE="node:20"
RUNNER_NAME="draw.tikz-$(hostname)"

install_runner() {
	if command -v gitlab-runner >/dev/null; then
		return
	fi
	echo "Installing gitlab-runner..."
	curl -fsSL "https://packages.gitlab.com/install/repositories/runner/gitlab-runner/script.deb.sh" | sudo bash
	sudo apt-get install -y gitlab-runner
}

is_registered() {
	sudo gitlab-runner list 2>&1 | grep -q "$GITLAB_URL"
}

register_runner() {
	if is_registered; then
		echo "A runner for $GITLAB_URL is already registered."
		return
	fi
	if ! docker info >/dev/null 2>&1; then
		echo "Docker is not running, but the runner uses the Docker executor. Start Docker first." >&2
		exit 1
	fi
	local token="${GITLAB_RUNNER_TOKEN:-}"
	if [ -z "$token" ]; then
		read -r -s -p "Runner authentication token (glrt-...): " token
		echo
	fi
	sudo gitlab-runner register --non-interactive \
		--url "$GITLAB_URL" \
		--token "$token" \
		--name "$RUNNER_NAME" \
		--executor docker \
		--docker-image "$DOCKER_IMAGE"
}

case "${1:-start}" in
	start)
		install_runner
		register_runner
		sudo gitlab-runner start
		sudo gitlab-runner status
		echo "Runner started. Re-run the pipeline in GitLab (Build > Pipelines > Run pipeline) or push to main."
		;;
	status)
		sudo gitlab-runner list
		sudo gitlab-runner status
		;;
	stop)
		sudo gitlab-runner stop
		;;
	*)
		echo "usage: $0 [start | status | stop]" >&2
		exit 1
		;;
esac
