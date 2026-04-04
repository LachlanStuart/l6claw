from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Sequence
from urllib.parse import urlsplit, urlunsplit

from browser_use import Agent, Browser
from browser_use.agent.views import ActionResult, AgentHistoryList, AgentOutput
from browser_use.browser.views import BrowserStateSummary
from browser_use.llm.anthropic.chat import ChatAnthropic
from browser_use.llm.base import BaseChatModel
from browser_use.llm.openai.chat import ChatOpenAI

TURN_DELIMITER = "<<EOF>>"
REQUIRED_ENV_VARS = (
    "BROWSER_AGENT_API_KEY",
    "BROWSER_AGENT_URL",
    "BROWSER_AGENT_MODEL",
)
SUPPRESSED_LOGGERS = (
    "anthropic",
    "browser_use",
    "cdp_use",
    "httpcore",
    "httpx",
    "openai",
    "urllib3",
    "websockets",
)


class SessionMode(str, Enum):
    DEFAULT = "default"
    HEADLESS = "headless"
    PROFILE = "profile"

    @property
    def startup_label(self) -> str:
        if self is SessionMode.HEADLESS:
            return "headless ephemeral"
        if self is SessionMode.PROFILE:
            return "visible default-profile"
        return "visible ephemeral"


class ModelProvider(str, Enum):
    OPENAI = "openai"
    ANTHROPIC = "anthropic"


@dataclass(frozen=True)
class CliOptions:
    mode: SessionMode
    interactive: bool
    initial_prompt: str


@dataclass(frozen=True)
class ModelSettings:
    api_key: str
    base_url: str
    model: str


@dataclass(frozen=True)
class TurnOutcome:
    history: AgentHistoryList[Any]
    completed: bool
    latest_error: str | None
    final_result: str | None


class StartupError(RuntimeError):
    pass


class FatalTurnError(RuntimeError):
    pass


def configure_library_logging() -> None:
    logging.basicConfig(level=logging.CRITICAL, force=True)
    for logger_name in SUPPRESSED_LOGGERS:
        logger = logging.getLogger(logger_name)
        logger.handlers.clear()
        logger.propagate = False
        logger.setLevel(logging.CRITICAL)


def parse_args(argv: Sequence[str]) -> CliOptions:
    parser = argparse.ArgumentParser(
        prog="l6claw-browser-agent",
        description="Long-lived browser-use REPL for L6 Claw.",
    )
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument(
        "--headless",
        action="store_true",
        help="Start a headless ephemeral browser session.",
    )
    mode_group.add_argument(
        "--profile",
        action="store_true",
        help="Start a visible browser session using the default local Chrome profile.",
    )
    parser.add_argument(
        "--interactive",
        action="store_true",
        help="Keep the process alive for follow-up turns over stdin after the initial prompt completes.",
    )
    parser.add_argument(
        "initial_prompt",
        help="Initial prompt to execute.",
    )
    args = parser.parse_args(argv)

    if args.headless:
        mode = SessionMode.HEADLESS
    elif args.profile:
        mode = SessionMode.PROFILE
    else:
        mode = SessionMode.DEFAULT

    return CliOptions(mode=mode, interactive=args.interactive, initial_prompt=args.initial_prompt)


def load_model_settings() -> ModelSettings:
    values = {name: os.environ.get(name) for name in REQUIRED_ENV_VARS}
    missing = [name for name, value in values.items() if not value]
    if missing:
        raise StartupError(f"Missing required environment variables: {', '.join(missing)}")
    return ModelSettings(
        api_key=values["BROWSER_AGENT_API_KEY"] or "",
        base_url=normalize_model_base_url(values["BROWSER_AGENT_URL"] or ""),
        model=values["BROWSER_AGENT_MODEL"] or "",
    )


def normalize_model_base_url(base_url: str) -> str:
    parts = urlsplit(base_url)
    path = parts.path.rstrip("/")
    if path in ("", "/"):
        path = "/v1"
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))


class ProtocolWriter:
    def emit_agent(self, message: str) -> None:
        self._emit("AGENT", message)

    def emit_info(self, message: str) -> None:
        self._emit("INFO", message)

    def emit_error(self, message: str) -> None:
        self._emit("ERROR", message)

    def emit_turn_end(self) -> None:
        print(TURN_DELIMITER, flush=True)

    def _emit(self, channel: str, message: str) -> None:
        normalized = message.replace("\r\n", "\n").replace("\r", "\n").strip()
        if not normalized:
            return
        for line in normalized.split("\n"):
            print(f"{channel}: {line}", flush=True)


@dataclass
class TurnReporter:
    writer: ProtocolWriter
    seen_messages: set[str] = field(default_factory=set)

    def report_step(
        self,
        *,
        step_number: int,
        model_output: AgentOutput,
        browser_state: BrowserStateSummary | None = None,
        results: list[ActionResult] | None = None,
    ) -> None:
        if browser_state and browser_state.url:
            self._emit_once(f"Step {step_number} page: {browser_state.url}")

        self._emit_once(
            f"Step {step_number} evaluation: {self._coalesce(model_output.evaluation_previous_goal)}"
        )
        self._emit_once(f"Step {step_number} memory: {self._coalesce(model_output.memory)}")
        self._emit_once(f"Step {step_number} next goal: {self._coalesce(model_output.next_goal)}")

        if model_output.plan_update:
            joined_plan = " | ".join(item.strip() for item in model_output.plan_update if item.strip())
            self._emit_once(f"Step {step_number} plan update: {joined_plan}")

        for action in model_output.action:
            payload = action.model_dump(exclude_none=True, mode="json")
            self._emit_once(f"Step {step_number} action: {format_action(payload)}")

        for result in results or []:
            self._report_result(step_number, result)

    def report_completion(self, final_result: str | None, latest_error: str | None) -> None:
        if final_result:
            self._emit_once(f"Final result: {final_result}")
            return

        if latest_error:
            self._emit_once(f"Task ended with error: {latest_error}")

    def _report_result(self, step_number: int, result: ActionResult) -> None:
        if result.extracted_content and not result.is_done:
            self._emit_once(f"Step {step_number} result: {result.extracted_content}")
        elif result.long_term_memory and not result.is_done:
            self._emit_once(f"Step {step_number} note: {result.long_term_memory}")
        if result.error:
            self._emit_once(f"Step {step_number} error: {result.error}")
        for attachment in result.attachments or []:
            self._emit_once(f"Step {step_number} attachment: {attachment}")

    def _emit_once(self, message: str) -> None:
        normalized = message.strip()
        if not normalized or normalized in self.seen_messages:
            return
        self.seen_messages.add(normalized)
        self.writer.emit_agent(normalized)

    @staticmethod
    def _coalesce(value: str | None) -> str:
        return value.strip() if value and value.strip() else "(empty)"


def format_action(action_payload: dict[str, Any]) -> str:
    if not action_payload:
        return "{}"

    action_name, params = next(iter(action_payload.items()))
    if not params:
        return action_name
    return f"{action_name} {json.dumps(params, ensure_ascii=True, sort_keys=True)}"


def choose_provider_order(base_url: str) -> list[ModelProvider]:
    lowered = base_url.lower()
    if "anthropic" in lowered or lowered.rstrip("/").endswith("/messages"):
        return [ModelProvider.ANTHROPIC, ModelProvider.OPENAI]
    return [ModelProvider.OPENAI, ModelProvider.ANTHROPIC]


def build_llm(settings: ModelSettings, provider: ModelProvider) -> BaseChatModel:
    if provider is ModelProvider.ANTHROPIC:
        return ChatAnthropic(
            model=settings.model,
            api_key=settings.api_key,
            base_url=settings.base_url,
        )

    return ChatOpenAI(
        model=settings.model,
        api_key=settings.api_key,
        base_url=settings.base_url,
    )


def looks_like_provider_mismatch(error: Exception) -> bool:
    text = str(error).lower()
    mismatch_markers = (
        "/chat/completions",
        "/messages",
        "404",
        "405",
        "not found",
        "unsupported",
        "unknown url",
        "expected anthropic",
        "expected openai",
    )
    network_markers = (
        "connection refused",
        "name or service not known",
        "temporary failure in name resolution",
        "timed out",
    )
    return any(marker in text for marker in mismatch_markers) and not any(
        marker in text for marker in network_markers
    )


class BrowserAgentRepl:
    def __init__(self, options: CliOptions, model_settings: ModelSettings) -> None:
        self.options = options
        self.model_settings = model_settings
        self.writer = ProtocolWriter()
        self.browser: Browser | None = None
        self.agent: Agent[Any, Any] | None = None
        self.provider: ModelProvider | None = None
        self.reporter: TurnReporter | None = None
        self.latest_state: BrowserStateSummary | None = None
        self.step_results: dict[int, list[ActionResult]] = {}

    async def start(self) -> None:
        self.browser = self._build_browser()
        await self.browser.start()
        self.writer.emit_info(f"Starting {self.options.mode.startup_label} browser session")
        self.writer.emit_info("Browser session ready")

    async def shutdown(self) -> None:
        if self.browser is None:
            return
        try:
            if self.options.mode is SessionMode.PROFILE:
                await self.browser.stop()
            else:
                await self.browser.kill()
        except Exception as error:  # pragma: no cover - cleanup best effort
            self.writer.emit_error(f"Error while closing browser session: {error}")

    async def run(self) -> int:
        await self.start()
        try:
            await self._run_turn(self.options.initial_prompt)
            if not self.options.interactive:
                return 0

            while True:
                prompt = await read_turn()
                if prompt is None:
                    return 0
                if not prompt.strip():
                    continue
                await self._run_turn(prompt)
        finally:
            await self.shutdown()

    async def _run_turn(self, prompt: str) -> None:
        self.reporter = TurnReporter(self.writer)
        self.latest_state = None
        self.step_results = {}
        try:
            outcome = await self._dispatch_turn(prompt)
            if not outcome.completed:
                if outcome.latest_error:
                    self.writer.emit_error(outcome.latest_error)
                else:
                    self.writer.emit_error("Task ended without a final done result.")
        except FatalTurnError as error:
            self.writer.emit_error(str(error))
            raise
        except Exception as error:
            self.writer.emit_error(str(error))
        finally:
            self.writer.emit_turn_end()

    async def _dispatch_turn(self, prompt: str) -> TurnOutcome:
        if self.agent is not None:
            self.agent.add_new_task(prompt)
            return await self._run_agent(self.agent)

        last_error: Exception | None = None
        for provider in choose_provider_order(self.model_settings.base_url):
            candidate = self._build_agent(prompt, provider)
            try:
                history = await self._run_agent(candidate)
            except Exception as error:
                last_error = error
                if not looks_like_provider_mismatch(error):
                    raise
                self.writer.emit_info(
                    f"Provider {provider.value} was rejected by the endpoint, retrying with the alternate client"
                )
                continue

            self.agent = candidate
            self.provider = provider
            self.writer.emit_info(f"Using {provider.value}-compatible model client")
            return history

        raise StartupError(str(last_error) if last_error else "Unable to initialize model client")

    async def _run_agent(self, agent: Agent[Any, Any]) -> TurnOutcome:
        start_index = len(agent.history.history)
        history = await agent.run(max_steps=500, on_step_end=self._on_step_end)
        new_history_items = history.history[start_index:]
        final_result = self._final_result(new_history_items)
        latest_error = self._latest_error(new_history_items)
        completed = self._is_done(new_history_items)
        if self.reporter is not None:
            self.reporter.report_completion(final_result, latest_error)
        if self._browser_unusable(latest_error):
            raise FatalTurnError(latest_error or "Browser session became unusable.")
        return TurnOutcome(
            history=history,
            completed=completed,
            latest_error=latest_error,
            final_result=final_result,
        )

    def _build_agent(self, prompt: str, provider: ModelProvider) -> Agent[Any, Any]:
        assert self.browser is not None, "Browser must be started before agent creation"
        return Agent(
            task=prompt,
            llm=build_llm(self.model_settings, provider),
            browser=self.browser,
            register_new_step_callback=self._on_new_step,
            enable_signal_handler=False,
        )

    def _build_browser(self) -> Browser:
        if self.options.mode is SessionMode.HEADLESS:
            return Browser(headless=True, keep_alive=True)
        if self.options.mode is SessionMode.PROFILE:
            return Browser.from_system_chrome(profile_directory=None, headless=False, keep_alive=True)
        return Browser(headless=False, keep_alive=True)

    async def _on_new_step(
        self,
        browser_state: BrowserStateSummary,
        model_output: AgentOutput,
        step_number: int,
    ) -> None:
        self.latest_state = browser_state
        self._emit_step(step_number, model_output)

    async def _on_step_end(self, agent: Agent[Any, Any]) -> None:
        model_output = agent.state.last_model_output
        if model_output is None:
            return
        step_number = max(agent.state.n_steps - 1, 1)
        self.step_results[step_number] = list(agent.state.last_result or [])
        self._emit_step(step_number, model_output)

    def _emit_step(self, step_number: int, model_output: AgentOutput) -> None:
        if self.reporter is None:
            return
        self.reporter.report_step(
            step_number=step_number,
            model_output=model_output,
            browser_state=self.latest_state,
            results=self.step_results.get(step_number),
        )

    @staticmethod
    def _latest_error(history_items: list[Any]) -> str | None:
        for item in reversed(history_items):
            for result in reversed(item.result):
                if result.error:
                    return result.error
        return None

    @staticmethod
    def _final_result(history_items: list[Any]) -> str | None:
        if not history_items:
            return None
        result = history_items[-1].result[-1]
        if result.is_done and result.extracted_content:
            return result.extracted_content
        return None

    @staticmethod
    def _is_done(history_items: list[Any]) -> bool:
        if not history_items:
            return False
        return history_items[-1].result[-1].is_done is True

    @staticmethod
    def _browser_unusable(error: str | None) -> bool:
        if not error:
            return False
        lowered = error.lower()
        fatal_markers = (
            "browser closed",
            "browser has been closed",
            "connection closed",
            "no browser",
            "websocket connection closed",
        )
        return any(marker in lowered for marker in fatal_markers)


async def read_turn() -> str | None:
    lines: list[str] = []
    while True:
        line = await asyncio.to_thread(sys.stdin.readline)
        if line == "":
            if not lines:
                return None
            return "".join(lines).rstrip("\n")
        if line.rstrip("\n") == TURN_DELIMITER:
            return "".join(lines).rstrip("\n")
        lines.append(line)


async def async_main(argv: Sequence[str]) -> int:
    configure_library_logging()
    options = parse_args(argv)
    model_settings = load_model_settings()
    repl = BrowserAgentRepl(options, model_settings)
    return await repl.run()


def main() -> None:
    try:
        raise SystemExit(asyncio.run(async_main(sys.argv[1:])))
    except FatalTurnError:
        raise SystemExit(1)
    except KeyboardInterrupt:
        print("INFO: Received interrupt, shutting down browser session", flush=True)
        raise SystemExit(130)
    except StartupError as error:
        print(f"ERROR: {error}", flush=True)
        raise SystemExit(1)
