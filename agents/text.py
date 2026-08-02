"""Text handling shared by every agent, on both sides of the call.

Going in, prompts have a character budget: a 3B model on CPU degrades long before
its advertised context and every extra token is CPU seconds. Coming out, a small
model's free-text lists arrive padded, duplicated and inconsistently punctuated.

Both problems are identical for the matcher, the question generator and the
evaluator, so they are solved once here rather than three times.
"""

import logging

logger = logging.getLogger(__name__)


def truncate(text, limit, label):
    """Trim to a character budget, preferring a paragraph boundary.

    Cutting mid-sentence hands the model a fragment it will try to complete;
    cutting at a blank line hands it a shorter but whole document. The boundary is
    only honoured if it falls in the second half, otherwise a document with one
    early blank line would lose most of its budget.
    """
    text = (text or "").strip()
    if len(text) <= limit:
        return text

    head = text[:limit]
    cut = head.rfind("\n\n")
    if cut > limit // 2:
        head = head[:cut]
    logger.info("Truncated %s from %d to %d chars for the prompt", label, len(text), len(head))
    return head.rstrip()


def collapse(text):
    """Flatten a model's whitespace to single spaces.

    Small models like to wrap prose at hard newlines mid-sentence. That renders as
    a broken paragraph in HTML, and the newlines carry no meaning worth keeping.
    """
    return " ".join(str(text or "").split())


def clean_list(values, limit):
    """De-duplicate short strings case-insensitively, keeping first-seen casing.

    Order is preserved because these lists arrive in the model's own priority
    order, and ``limit`` is a hard cap: a list longer than that is the model
    padding rather than finding, and the UI has nowhere to put it.
    """
    seen, cleaned = set(), []
    for value in values or ():
        name = collapse(value).strip(" .,;-")
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        cleaned.append(name)
    return cleaned[:limit]
