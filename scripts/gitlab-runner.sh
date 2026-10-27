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
	if command -v apt-get >/dev/null; then
		curl -fsSL "https://packages.gitlab.com/install/repositories/runner/gitlab-runner/script.deb.sh" | sudo bash
		sudo apt-get install -y gitlab-runner
		return
	fi
	if command -v dnf >/dev/null; then
		if curl -fsSL "https://packages.gitlab.com/install/repositories/runner/gitlab-runner/script.rpm.sh" | sudo bash &&
			sudo dnf install -y gitlab-runner; then
			return
		fi
		echo "No gitlab-runner package for this Fedora version, installing the official binary instead."
	fi
	# the official binary, installed as a systemd service
	sudo curl -fL --output /usr/local/bin/gitlab-runner \
		"https://gitlab-runner-downloads.s3.amazonaws.com/latest/binaries/gitlab-runner-linux-amd64"
	sudo chmod +x /usr/local/bin/gitlab-runner
	if ! id gitlab-runner >/dev/null 2>&1; then
		sudo useradd --comment "GitLab Runner" --create-home --shell /bin/bash gitlab-runner
	fi
	sudo /usr/local/bin/gitlab-runner install --user=gitlab-runner --working-directory=/home/gitlab-runner
}

# sudo with the full path: sudo's PATH on Fedora does not include /usr/local/bin
runner() {
	sudo "$(command -v gitlab-runner)" "$@"
}

ensure_docker() {
	if sudo docker info >/dev/null 2>&1; then
		return
	fi
	echo "Starting Docker..."
	sudo systemctl enable --now docker
	if ! sudo docker info >/dev/null 2>&1; then
		echo "Docker could not be started, but the runner uses the Docker executor." >&2
		exit 1
	fi
}

is_registered() {
	runner list 2>&1 | grep -q "$GITLAB_URL"
}

register_runner() {
	if is_registered; then
		echo "A runner for $GITLAB_URL is already registered."
		return
	fi
	local token="${GITLAB_RUNNER_TOKEN:-}"
	if [ -z "$token" ]; then
		read -r -s -p "Runner authentication token (glrt-...): " token
		echo
	fi
	runner register --non-interactive \
		--url "$GITLAB_URL" \
		--token "$token" \
		--name "$RUNNER_NAME" \
		--executor docker \
		--docker-image "$DOCKER_IMAGE"
}

case "${1:-start}" in
	start)
		install_runner
		ensure_docker
		register_runner
		runner start
		runner status
		echo "Runner started. Re-run the pipeline in GitLab (Build > Pipelines > Run pipeline) or push to main."
		;;
	status)
		runner list
		runner status
		;;
	stop)
		runner stop
		;;
	*)
		echo "usage: $0 [start | status | stop]" >&2
		exit 1
		;;
esac
