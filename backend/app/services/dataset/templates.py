"""Pre-registered dataset templates for TokenPilot benchmark datasets."""
from typing import List, Optional, Dict
from app.schemas.dataset import DatasetTemplate, TaskType, EvaluationRole

# Pinned commit SHAs from Hugging Face Hub
GSM8K_PINNED_REVISION = "740312add88f781978c0658806c59bc2815b9866"
HUMANEVAL_PINNED_REVISION = "7dce6050a7d6d172f3cc5c32aa97f52fa1a2e544"

DATASET_TEMPLATES: Dict[str, DatasetTemplate] = {
    "gsm8k": DatasetTemplate(
        id="gsm8k",
        name="GSM8K (Grade School Math 8K)",
        description="High-quality dataset of 8,500 grade school math word problems requiring multi-step mathematical reasoning.",
        task_type=TaskType.MATH_REASONING,
        hf_repo_id="openai/gsm8k",
        default_config="main",
        available_splits=["test", "train"],
        allowed_roles_per_split={
            "test": [EvaluationRole.HELD_OUT_TEST],
            "train": [EvaluationRole.DEV_TRAIN, EvaluationRole.VALIDATION],
        },
        license="MIT",
        license_verified=True,
        pinned_revision=GSM8K_PINNED_REVISION,
        recommended_subsets=[5, 10, 25, 50, 100],
        sample_records=[
            {
                "task_id": "gsm8k_sample_1",
                "question": "Janet's ducks lay 16 eggs per day. She eats three for breakfast every morning and bakes muffins for her friends every day with four. She sells the remainder at the farmers' market daily for $2 per fresh duck egg. How much in dollars does she make every day at the farmers' market?",
                "reference_answer": "Janet sells 16 - 3 - 4 = 9 duck eggs a day. She makes 9 * 2 = $18 every day. #### 18",
                "extracted_answer": "18",
            },
            {
                "task_id": "gsm8k_sample_2",
                "question": "A robe takes 2 bolts of blue fiber and half that much white fiber. How many bolts in total does it take?",
                "reference_answer": "It takes 2 / 2 = 1 bolt of white fiber. Total is 2 + 1 = 3 bolts. #### 3",
                "extracted_answer": "3",
            },
            {
                "task_id": "gsm8k_sample_3",
                "question": "Josh decides to try flipping a house. He buys a house for $80,000 and puts in $50,000 in repairs. This increased the value of the house by 150% of the original purchase price. How much profit does he make?",
                "reference_answer": "The value increased by 80000 * 1.5 = $120,000. New value is 80000 + 120000 = $200,000. Total cost was 80000 + 50000 = $130,000. Profit is 200000 - 130000 = $70,000. #### 70000",
                "extracted_answer": "70000",
            },
        ],
    ),
    "humaneval": DatasetTemplate(
        id="humaneval",
        name="HumanEval (Python Code Generation)",
        description="164 hand-written Python programming problems assessing functional correctness with unit test suites.",
        task_type=TaskType.CODE_GENERATION,
        hf_repo_id="openai/openai_humaneval",
        default_config="openai_humaneval",
        available_splits=["test"],
        allowed_roles_per_split={
            "test": [EvaluationRole.HELD_OUT_TEST],
        },
        license="MIT",
        license_verified=True,
        pinned_revision=HUMANEVAL_PINNED_REVISION,
        recommended_subsets=[5, 10, 25, 50, 164],
        sample_records=[
            {
                "task_id": "HumanEval/0",
                "entry_point": "has_close_elements",
                "prompt": "from typing import List\n\ndef has_close_elements(numbers: List[float], threshold: float) -> bool:\n    \"\"\" Check if in given list of numbers, are any two numbers closer to each other than given threshold.\n    >>> has_close_elements([1.0, 2.0, 3.0], 0.5)\n    False\n    >>> has_close_elements([1.0, 2.8, 3.0, 4.0, 5.0, 2.0], 0.3)\n    True\n    \"\"\"\n",
                "canonical_solution": "    for idx, elem in enumerate(numbers):\n        for idx2, elem2 in enumerate(numbers):\n            if idx != idx2:\n                distance = abs(elem - elem2)\n                if distance < threshold:\n                    return True\n    return False\n",
                "test": "def check(candidate):\n    assert candidate([1.0, 2.0, 3.9, 4.0, 5.0, 2.2], 0.3) == True\n    assert candidate([1.0, 2.0, 3.9, 4.0, 5.0, 2.2], 0.05) == False\n",
            },
            {
                "task_id": "HumanEval/1",
                "entry_point": "separate_paren_groups",
                "prompt": "from typing import List\n\ndef separate_paren_groups(paren_string: str) -> List[str]:\n    \"\"\" Input to this function is a string containing multiple groups of nested parentheses.\n    Return list of those separate strings.\n    >>> separate_paren_groups('( ) (( )) (( )( ))')\n    ['()', '(())', '(()())']\n    \"\"\"\n",
                "canonical_solution": "    result = []\n    current_string = []\n    current_depth = 0\n    for c in paren_string:\n        if c == '(':\n            current_depth += 1\n            current_string.append(c)\n        elif c == ')':\n            current_depth -= 1\n            current_string.append(c)\n            if current_depth == 0:\n                result.append(''.join(current_string))\n                current_string.clear()\n    return result\n",
                "test": "def check(candidate):\n    assert candidate('(()()) ((())) () ((())()())') == ['(()())', '((()))', '()', '((())()())']\n",
            },
        ],
    ),
}


def list_dataset_templates() -> List[DatasetTemplate]:
    """Return all pre-registered dataset templates."""
    return list(DATASET_TEMPLATES.values())


def get_dataset_template(dataset_id: str) -> Optional[DatasetTemplate]:
    """Retrieve template by identifier (e.g. 'gsm8k' or 'humaneval')."""
    return DATASET_TEMPLATES.get(dataset_id.lower().strip())
