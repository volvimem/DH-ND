(() => {
    'use strict';

    const field = id => document.getElementById(id);
    const cpfInput = field('login-cpf');
    const secretInput = field('login-pass');
    const methodButton = field('login-method-toggle');
    const submit = field('btn-acessar');
    const help = field('login-code-help');
    let codeMode = false;

    function selectMethod(useCode) {
        codeMode = useCode;
        secretInput.value = '';
        secretInput.type = 'password';
        secretInput.autocomplete = useCode ? 'one-time-code' : 'current-password';
        secretInput.placeholder = useCode ? 'Código recebido' : '••••';
        secretInput.nextElementSibling.classList.remove('fa-eye-slash');
        secretInput.nextElementSibling.classList.add('fa-eye');
        field('login-cpf-label').textContent = useCode ? 'CPF DO ATLETA QUE RECEBEU O CÓDIGO' : 'CPF';
        field('login-pass-label').textContent = useCode ? 'CÓDIGO TEMPORÁRIO' : 'SENHA';
        submit.textContent = useCode ? 'VALIDAR CÓDIGO' : 'ACESSAR CONTA';
        methodButton.textContent = useCode ? 'Voltar para a senha' : 'Usar código temporário de atleta';
        methodButton.setAttribute('aria-pressed', String(useCode));
        help.hidden = true;
    }

    function showHolder(cpf) {
        field('setup-cpf-ending').textContent = 'CPF do atleta, final ' + cpf.slice(-4) + '. ';
    }

    methodButton.addEventListener('click', () => {
        if (loginInProgress) return;
        selectMethod(!codeMode);
        if (codeMode) cpfInput.value = '';
        (cpfInput.value ? secretInput : cpfInput).focus();
    });
    methodButton.hidden = false;

    submit.onclick = async () => {
        if (loginInProgress) return false;
        const cpf = cleanCPF(cpfInput.value);
        const code = secretInput.value.trim();
        const resemblesCode = /^(?:\d{6}|DHND-[A-Za-z0-9_-]{22})$/.test(code);
        help.hidden = true;
        if (!codeMode) {
            const success = await window.fazerLogin();
            if (success && temporaryPasswordSetup) showHolder(temporaryPasswordSetup.cpf);
            if (!success && resemblesCode) help.hidden = false;
            return success;
        }

        if (!/^\d{11}$/.test(cpf) || !resemblesCode) {
            toast('INFORME O CPF DE 11 DÍGITOS DO ATLETA E O CÓDIGO QUE ELE RECEBEU.', 'error');
            return false;
        }
        if (!auth) {
            toast('O SERVIÇO DE LOGIN ESTÁ INDISPONÍVEL. TENTE NOVAMENTE.', 'error');
            return false;
        }
        const remember = field('login-remember').checked;
        loginInProgress = true;
        submit.disabled = methodButton.disabled = cpfInput.disabled = secretInput.disabled = true;
        try {
            toast('VALIDANDO CÓDIGO...', 'info');
            const {resetCode, uid} = await requestTemporaryPasswordReset(cpf, code);
            showHolder(cpf);
            selectMethod(false);
            openTemporaryPasswordSetup({cpf, remember, resetCode, uid});
            return true;
        } catch (error) {
            const messages = {
                'functions/permission-denied': 'CÓDIGO NÃO ACEITO. CONFIRA O CPF DO ATLETA E USE UM CÓDIGO NOVO GERADO PARA ELE NESTE SITE.',
                'functions/resource-exhausted': 'AGUARDE UM POUCO ANTES DE TENTAR O CÓDIGO NOVAMENTE.'
            };
            toast(messages[error?.code] || 'NÃO FOI POSSÍVEL VALIDAR O CÓDIGO AGORA. VERIFIQUE A CONEXÃO OU FALE COM O SUPORTE.', 'error');
            return false;
        } finally {
            loginInProgress = false;
            submit.disabled = methodButton.disabled = cpfInput.disabled = secretInput.disabled = false;
        }
    };

    field('btn-issue-athlete-temp-login').onclick = async () => {
        const cpf = cleanCPF(field('super-edit-old-cpf').value);
        const athlete = db.users.find(user => user && cleanCPF(user.cpf) === cpf);
        const account = getAuthenticatedProfileAccount(loggedUser);
        if (account && athlete && (athlete.uid === account.uid || isSuperAdmin(athlete) || athlete.role === 'ORGANIZER')) {
            toast('O CÓDIGO É EXCLUSIVO PARA ATLETAS. PARA CONTA ADMINISTRATIVA, FALE COM O RESPONSÁVEL PELO SISTEMA.', 'error');
            return;
        }
        await window.gerarSenhaTemporaria();
    };

    // O modal é reutilizado para vários atletas. Exiba o sufixo junto ao código retornado.
    const display = field('super-edit-temp-pass-display');
    new MutationObserver(() => {
        const cpf = cleanCPF(field('super-edit-old-cpf').value);
        field('super-edit-temp-help').textContent = display.textContent && cpf
            ? 'Código para o atleta de CPF final ' + cpf.slice(-4) + '. Use esse mesmo CPF no login.'
            : 'O atleta deve usar o mesmo CPF selecionado aqui.';
    }).observe(display, {childList:true});
})();
