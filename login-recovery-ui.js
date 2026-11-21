(() => {
    'use strict';

    const field = id => document.getElementById(id);
    const help = field('login-code-help');

    field('btn-acessar').onclick = async () => {
        if (loginInProgress) return false;
        const resemblesCode = /^(?:\d{6}|DHND-[A-Za-z0-9_-]{22})$/.test(field('login-pass').value.trim());
        help.hidden = true;
        const success = await window.fazerLogin();
        if (success && temporaryPasswordSetup) {
            field('setup-cpf-ending').textContent = 'CPF do atleta, final ' + temporaryPasswordSetup.cpf.slice(-4) + '. ';
        } else if (!success && resemblesCode) {
            help.hidden = false;
        }
        return success;
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
