import sys
from pathlib import Path

# The worker runs as `python -m research_desk` from workers/research-desk, so
# the tests import it the same way, without installing anything.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
