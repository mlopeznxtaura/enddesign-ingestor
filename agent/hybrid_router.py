"""
Hybrid Router — Route task to template or LLM coder.
"""

from typing import Optional, Dict, Any

from .logger import setup_logger
from .template_coder import TemplateCoder
from .gemini_coder import GeminiCoder
from .syntax_check import SyntaxChecker

logger = setup_logger(__name__)


class HybridRouter:
    """Route tasks to template or LLM-based code generation."""

    # Task IDs that have templates
    TEMPLATE_TASKS = {
        'rust_backend.pkce_rfc7636',
        'rust_backend.callback_server',
        'oauth_integration.callback_server',
        'oauth_integration.token_keychain',
        'phase9.task_145',
        'phase9.task_147',
        'phase9.task_149',
        'phase9.task_151',
    }

    def __init__(self):
        """Initialize hybrid router."""
        self.template_coder = TemplateCoder()
        self.llm_coder = GeminiCoder()
        self.syntax_checker = SyntaxChecker()

    def generate_code(self, task: Dict[str, Any]) -> Optional[str]:
        """Generate code for task using template or LLM.
        
        Args:
            task: Task dictionary
            
        Returns:
            Generated code string or None
        """
        task_id = task.get('id', '')

        # Route to template if available
        if task_id in self.TEMPLATE_TASKS or task_id.startswith('phase9.task'):
            logger.info(f"Using template for task: {task_id}")
            return self._generate_from_template(task)

        # Otherwise use LLM
        logger.info(f"Using LLM for task: {task_id}")
        return self._generate_from_llm(task)

    def _generate_from_template(self, task: Dict[str, Any]) -> Optional[str]:
        """Generate code from template.
        
        Args:
            task: Task dictionary
            
        Returns:
            Generated code string or None
        """
        # Map Phase 9 task IDs to their respective template IDs
        task_id = task.get('id', '')
        template_id = task_id
        
        if task_id == 'phase9.task_145':
            template_id = 'rust_backend.pkce_rfc7636'
        elif task_id == 'phase9.task_147':
            template_id = 'oauth_integration.callback_server'
        elif task_id == 'phase9.task_149':
            template_id = 'rust_backend.callback_server' # Assuming this for now
        elif task_id == 'phase9.task_151':
            template_id = 'oauth_integration.token_keychain'
            
        task_with_template_id = task.copy()
        task_with_template_id['id'] = template_id
        
        code = self.template_coder.generate_code(task_with_template_id)
        
        if not code:
            logger.warning(f"Template not found for {task_id}, falling back to LLM")
            return self._generate_from_llm(task)
            
        return code

    def _generate_from_llm(self, task: Dict[str, Any]) -> Optional[str]:
        """Generate code from LLM (codellama:7b).
        
        Args:
            task: Task dictionary
            
        Returns:
            Generated code string or None
        """
        # Call the actual LLM coder with retry and syntax validation
        code, success, attempts = self.llm_coder.generate_with_retry(
            task, 
            syntax_checker=self.syntax_checker
        )
        
        if not success or not code:
            logger.error(f"LLM failed for task {task['id']} after {attempts} attempts")
            # If LLM fails completely, generate fallback code so build doesn't crash
            return self.template_coder.generate_fallback_code(task)
            
        return code
